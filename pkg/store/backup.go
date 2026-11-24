package store

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// CampaignBundle is a portable, versioned, checksummed JSON export of Rollhaven data.
type CampaignBundle struct {
	SchemaVersion    int               `json:"schema_version"`
	App              string            `json:"app"`
	Version          string            `json:"version"`
	ExportedAt       time.Time         `json:"exported_at"`
	Campaign         Campaign          `json:"campaign"`
	CampaignSessions []CampaignSession `json:"campaign_sessions"`
	RoomSession      Session           `json:"room_session"`
	Players          []Player          `json:"players"`
	MapEntities      []MapEntity       `json:"map_entities"`
	CampaignNotes    []CampaignNote    `json:"campaign_notes"`
	ChatMessages     []ChatMessage     `json:"chat_messages"`
	RollTables       []RollTable       `json:"roll_tables"`
	ActionLog        []ActionLogEntry  `json:"action_log"`
	AuditEvents      []AuditEvent      `json:"audit_events"`
	ChecksumSHA256   string            `json:"checksum_sha256"`
}

// BackupManifest stores SHA-256 verification metadata inside a full ZIP backup archive.
type BackupManifest struct {
	SchemaVersion int               `json:"schema_version"`
	App           string            `json:"app"`
	Version       string            `json:"version"`
	CreatedAt     time.Time         `json:"created_at"`
	BundleSHA256  string            `json:"bundle_sha256"`
	AssetHashes   map[string]string `json:"asset_hashes"`
}

func computeBundleChecksum(b CampaignBundle) (string, error) {
	b.ChecksumSHA256 = ""
	raw, err := json.Marshal(b)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// ExportCampaignBundle creates a self-verifying portable snapshot of the active campaign and room state.
func (s *Store) ExportCampaignBundle() (CampaignBundle, error) {
	roomSess, err := s.GetSession()
	if err != nil {
		return CampaignBundle{}, err
	}
	camp, err := s.GetActiveCampaign()
	if err != nil {
		return CampaignBundle{}, err
	}
	campSessions, _ := s.ListCampaignSessions(camp.ID)
	players, _ := s.ListPlayersOrdered()
	// Include player notes on each exported player
	for i := range players {
		players[i].Notes, _ = s.GetPlayerNotes(players[i].ID)
	}
	entities, _ := s.ListMapEntities()
	notes, _ := s.ListCampaignNotesForViewer(camp.ID, "", true)
	// Also include player private notes in full GM backup bundle
	allNotes, err := s.listAllCampaignNotesRaw(camp.ID)
	if err == nil {
		notes = allNotes
	}
	msgs, _ := s.ListChatMessagesForViewer(camp.ID, "", true, 500)
	tables, _ := s.ListRollTables(camp.ID)
	logs, _ := s.ListActionLogForViewer(camp.ID, "", true, 500)
	audits, _ := s.ListAuditEvents(camp.ID, 200)

	bundle := CampaignBundle{
		SchemaVersion:    5,
		App:              "Rollhaven",
		Version:          "1.5.0",
		ExportedAt:       time.Now().UTC(),
		Campaign:         camp,
		CampaignSessions: campSessions,
		RoomSession:      roomSess,
		Players:          players,
		MapEntities:      entities,
		CampaignNotes:    notes,
		ChatMessages:     msgs,
		RollTables:       tables,
		ActionLog:        logs,
		AuditEvents:      audits,
	}
	sum, err := computeBundleChecksum(bundle)
	if err != nil {
		return CampaignBundle{}, err
	}
	bundle.ChecksumSHA256 = sum
	return bundle, nil
}

func (s *Store) listAllCampaignNotesRaw(campaignID string) ([]CampaignNote, error) {
	rows, err := s.db.Query(`
		SELECT id, campaign_id, owner_id, owner_name, title, body, category, visibility, recipients_json, allow_edit, version, created_at, updated_at
		FROM campaign_notes WHERE campaign_id = ?
		ORDER BY updated_at DESC
	`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CampaignNote
	for rows.Next() {
		var n CampaignNote
		var recStr string
		var allowInt int
		if err := rows.Scan(
			&n.ID, &n.CampaignID, &n.OwnerID, &n.OwnerName, &n.Title, &n.Body,
			&n.Category, &n.Visibility, &recStr, &allowInt, &n.Version, &n.CreatedAt, &n.UpdatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(recStr), &n.RecipientIDs)
		if n.RecipientIDs == nil {
			n.RecipientIDs = []string{}
		}
		n.AllowEdit = allowInt != 0
		out = append(out, n)
	}
	if out == nil {
		out = []CampaignNote{}
	}
	return out, rows.Err()
}

// ImportCampaignBundle validates checksum & schema version before restoring campaign data transactionally.
func (s *Store) ImportCampaignBundle(b CampaignBundle) error {
	if b.SchemaVersion <= 0 || b.SchemaVersion > 10 {
		return fmt.Errorf("versión de esquema incompatible en backup: %d", b.SchemaVersion)
	}
	expectedSum, err := computeBundleChecksum(b)
	if err != nil {
		return err
	}
	if strings.TrimSpace(b.ChecksumSHA256) == "" || !strings.EqualFold(b.ChecksumSHA256, expectedSum) {
		return fmt.Errorf("fallo de integridad SHA-256 en el archivo de campaña")
	}
	if strings.TrimSpace(b.Campaign.ID) == "" {
		b.Campaign.ID = "default"
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO campaigns (id, name, description, system_name, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, system_name = excluded.system_name, status = excluded.status, updated_at = CURRENT_TIMESTAMP
	`, b.Campaign.ID, b.Campaign.Name, b.Campaign.Description, b.Campaign.SystemName, b.Campaign.Status, b.Campaign.CreatedAt)
	if err != nil {
		return err
	}

	// Replace campaign-scoped data cleanly inside the same transaction
	for _, q := range []string{
		`DELETE FROM campaign_sessions WHERE campaign_id = ?`,
		`DELETE FROM campaign_notes WHERE campaign_id = ?`,
		`DELETE FROM chat_messages WHERE campaign_id = ?`,
		`DELETE FROM roll_tables WHERE campaign_id = ?`,
		`DELETE FROM action_log WHERE campaign_id = ?`,
		`DELETE FROM audit_events WHERE campaign_id = ?`,
	} {
		if _, err := tx.Exec(q, b.Campaign.ID); err != nil {
			return err
		}
	}

	for _, cs := range b.CampaignSessions {
		if _, err := tx.Exec(`
			INSERT INTO campaign_sessions (id, campaign_id, title, status, started_at, ended_at, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, cs.ID, b.Campaign.ID, cs.Title, cs.Status, cs.StartedAt, cs.EndedAt, cs.CreatedAt); err != nil {
			return err
		}
	}

	mapEnabledInt := 0
	if b.RoomSession.MapEnabled {
		mapEnabledInt = 1
	}
	if _, err := tx.Exec(`
		UPDATE sessions
		SET map_enabled = ?, map_rows = ?, map_cols = ?, map_image_path = ?, map_grid_color = ?, map_grid_opacity = ?, current_turn_index = ?, active_campaign_id = ?
		WHERE id = ?
	`, mapEnabledInt, b.RoomSession.MapRows, b.RoomSession.MapCols, b.RoomSession.MapImagePath, b.RoomSession.MapGridColor, b.RoomSession.MapGridOpacity, b.RoomSession.CurrentTurnIndex, b.Campaign.ID, DefaultSessionID); err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM players WHERE session_id = ?`, DefaultSessionID); err != nil {
		return err
	}
	for _, p := range b.Players {
		th, mo, conn := 0, 0, 0
		if p.TokenHidden {
			th = 1
		}
		if p.ManualOrder {
			mo = 1
		}
		if p.IsConnected {
			conn = 1
		}
		role := p.Role
		if role == "" {
			role = "PLAYER"
		}
		mstatus := p.MembershipStatus
		if mstatus == "" {
			mstatus = "ACTIVE"
		}
		if _, err := tx.Exec(`
			INSERT INTO players (
				id, session_id, name, initiative, race_icon, color_hex, character_sheet_path,
				token_x, token_y, token_hidden, turn_order, manual_order, is_connected,
				client_ip, user_agent, latency_ms, role, membership_status, created_at, last_seen
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, p.ID, DefaultSessionID, p.Name, p.Initiative, p.RaceIcon, p.ColorHex, p.CharacterSheetPath,
			p.TokenX, p.TokenY, th, p.TurnOrder, mo, conn,
			p.ClientIP, p.UserAgent, p.LatencyMS, role, mstatus, p.CreatedAt, p.LastSeen); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT OR REPLACE INTO player_notes (player_id, content) VALUES (?, ?)`, p.ID, p.Notes); err != nil {
			return err
		}
		for _, it := range p.Inventory {
			if _, err := tx.Exec(`
				INSERT INTO inventory_items (id, player_id, name, quantity, description)
				VALUES (?, ?, ?, ?, ?)
			`, it.ID, p.ID, it.Name, it.Quantity, it.Description); err != nil {
				return err
			}
		}
	}

	if _, err := tx.Exec(`DELETE FROM map_entities WHERE session_id = ?`, DefaultSessionID); err != nil {
		return err
	}
	for _, ent := range b.MapEntities {
		hid := 0
		if ent.IsHidden {
			hid = 1
		}
		if _, err := tx.Exec(`
			INSERT INTO map_entities (id, session_id, kind, name, x, y, size, color_hex, hp_current, hp_max, note, is_hidden, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, ent.ID, DefaultSessionID, ent.Kind, ent.Name, ent.X, ent.Y, ent.Size, ent.ColorHex, ent.HPCurrent, ent.HPMax, ent.Note, hid, ent.CreatedAt); err != nil {
			return err
		}
	}

	for _, n := range b.CampaignNotes {
		rec, _ := json.Marshal(n.RecipientIDs)
		allowInt := 0
		if n.AllowEdit {
			allowInt = 1
		}
		if _, err := tx.Exec(`
			INSERT INTO campaign_notes (id, campaign_id, owner_id, owner_name, title, body, category, visibility, recipients_json, allow_edit, version, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, n.ID, b.Campaign.ID, n.OwnerID, n.OwnerName, n.Title, n.Body, n.Category, n.Visibility, string(rec), allowInt, n.Version, n.CreatedAt, n.UpdatedAt); err != nil {
			return err
		}
	}

	for _, m := range b.ChatMessages {
		rec, _ := json.Marshal(m.RecipientIDs)
		if _, err := tx.Exec(`
			INSERT INTO chat_messages (id, campaign_id, session_id, author_id, author_name, author_role, author_color, body, visibility, recipients_json, command_id, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, m.ID, b.Campaign.ID, m.SessionID, m.AuthorID, m.AuthorName, m.AuthorRole, m.AuthorColor, m.Body, m.Visibility, string(rec), m.CommandID, m.CreatedAt); err != nil {
			return err
		}
	}

	for _, rt := range b.RollTables {
		rawEntries, _ := json.Marshal(rt.Entries)
		if _, err := tx.Exec(`
			INSERT INTO roll_tables (id, campaign_id, name, description, entries_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, rt.ID, b.Campaign.ID, rt.Name, rt.Description, string(rawEntries), rt.CreatedAt); err != nil {
			return err
		}
	}

	// Preserve chronological insertion order for action log entries
	for i := len(b.ActionLog) - 1; i >= 0; i-- {
		e := b.ActionLog[i]
		if _, err := tx.Exec(`
			INSERT INTO action_log (session_id, campaign_id, player_id, roller_id, player_name, action_type, details, visibility, command_id, result_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, DefaultSessionID, b.Campaign.ID, e.PlayerID, e.RollerID, e.PlayerName, e.ActionType, e.Details, e.Visibility, e.CommandID, string(e.ResultJSON), e.CreatedAt); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	_ = s.AppendAuditEvent(b.Campaign.ID, "dm", "Dungeon Master", "BACKUP_IMPORT", fmt.Sprintf("Importada campaña %q desde backup verificado", b.Campaign.Name))
	return nil
}

// CreateFullBackupZip packages bundle.json, uploads/* assets, and SHA-256 manifest.json into a single ZIP archive.
func (s *Store) CreateFullBackupZip(dataDir string) ([]byte, error) {
	bundle, err := s.ExportCampaignBundle()
	if err != nil {
		return nil, err
	}
	bundleBytes, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return nil, err
	}
	bSum := sha256.Sum256(bundleBytes)

	manifest := BackupManifest{
		SchemaVersion: 5,
		App:           "Rollhaven",
		Version:       "1.5.0",
		CreatedAt:     time.Now().UTC(),
		BundleSHA256:  hex.EncodeToString(bSum[:]),
		AssetHashes:   make(map[string]string),
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	wBundle, err := zw.Create("bundle.json")
	if err != nil {
		return nil, err
	}
	if _, err := wBundle.Write(bundleBytes); err != nil {
		return nil, err
	}

	uploadsDir := filepath.Join(dataDir, "uploads")
	if info, statErr := os.Stat(uploadsDir); statErr == nil && info.IsDir() {
		err = filepath.WalkDir(uploadsDir, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return walkErr
			}
			rel, err := filepath.Rel(uploadsDir, path)
			if err != nil {
				return err
			}
			zipRel := filepath.ToSlash(filepath.Join("assets", rel))
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(raw)
			manifest.AssetHashes[zipRel] = hex.EncodeToString(sum[:])

			fw, err := zw.Create(zipRel)
			if err != nil {
				return err
			}
			_, err = fw.Write(raw)
			return err
		})
		if err != nil {
			return nil, err
		}
	}

	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	wMan, err := zw.Create("manifest.json")
	if err != nil {
		return nil, err
	}
	if _, err := wMan.Write(manifestBytes); err != nil {
		return nil, err
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// RestoreFullBackupZip verifies manifest & file SHA-256 checksums before restoring database state and asset files.
func (s *Store) RestoreFullBackupZip(dataDir string, zipBytes []byte) error {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return fmt.Errorf("archivo ZIP inválido: %w", err)
	}

	files := make(map[string][]byte)
	var totalUncompressed int64
	const maxRestoreBytes = 100 << 20 // 100 MB guard against zip bombs

	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		clean := filepath.ToSlash(filepath.Clean(f.Name))
		if strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || clean == ".." {
			return fmt.Errorf("ruta insegura detectada en backup: %s", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxRestoreBytes-totalUncompressed+1))
		_ = rc.Close()
		if err != nil {
			return err
		}
		totalUncompressed += int64(len(data))
		if totalUncompressed > maxRestoreBytes {
			return fmt.Errorf("el backup excede el tamaño máximo permitido de restauración")
		}
		files[clean] = data
	}

	manRaw, okMan := files["manifest.json"]
	bunRaw, okBun := files["bundle.json"]
	if !okMan || !okBun {
		return fmt.Errorf("backup incompleto: falta manifest.json o bundle.json")
	}

	var manifest BackupManifest
	if err := json.Unmarshal(manRaw, &manifest); err != nil {
		return fmt.Errorf("manifest.json corrupto: %w", err)
	}
	actualBundleSum := sha256.Sum256(bunRaw)
	if !strings.EqualFold(hex.EncodeToString(actualBundleSum[:]), manifest.BundleSHA256) {
		return fmt.Errorf("fallo de verificación SHA-256 en bundle.json")
	}

	for assetPath, expectedHash := range manifest.AssetHashes {
		assetData, ok := files[assetPath]
		if !ok {
			return fmt.Errorf("falta archivo adjunto referenciado en backup: %s", assetPath)
		}
		sum := sha256.Sum256(assetData)
		if !strings.EqualFold(hex.EncodeToString(sum[:]), expectedHash) {
			return fmt.Errorf("fallo de integridad SHA-256 en adjunto %s", assetPath)
		}
	}

	var bundle CampaignBundle
	if err := json.Unmarshal(bunRaw, &bundle); err != nil {
		return fmt.Errorf("bundle.json inválido: %w", err)
	}

	// Stage and restore assets cleanly before/with DB import
	uploadsDir := filepath.Join(dataDir, "uploads")
	_ = os.MkdirAll(filepath.Join(uploadsDir, "maps"), 0o755)
	_ = os.MkdirAll(filepath.Join(uploadsDir, "sheets"), 0o755)
	for assetPath, assetData := range files {
		if !strings.HasPrefix(assetPath, "assets/") {
			continue
		}
		rel := strings.TrimPrefix(assetPath, "assets/")
		dst := filepath.Join(uploadsDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dst, assetData, 0o644); err != nil {
			return err
		}
	}

	return s.ImportCampaignBundle(bundle)
}
