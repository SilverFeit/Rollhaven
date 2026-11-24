package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/SilverFeit/Rollhaven/pkg/engine"
	"github.com/google/uuid"
)

// ErrVersionConflict indicates an optimistic concurrency conflict when updating a CampaignNote.
var ErrVersionConflict = errors.New("conflicto de versión: la nota fue modificada por otro usuario")

// Campaign represents an isolated TTRPG world/campaign within Rollhaven.
type Campaign struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	SystemName  string    `json:"system_name"`
	Status      string    `json:"status"` // ACTIVE | ARCHIVED
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CampaignSession tracks individual game sessions belonging to a Campaign.
type CampaignSession struct {
	ID         string     `json:"id"`
	CampaignID string     `json:"campaign_id"`
	Title      string     `json:"title"`
	Status     string     `json:"status"` // PLANNED | ACTIVE | PAUSED | CLOSED
	StartedAt  time.Time  `json:"started_at"`
	EndedAt    *time.Time `json:"ended_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// CampaignNote represents a campaign journal entry with explicit audience and optimistic versioning.
type CampaignNote struct {
	ID           string    `json:"id"`
	CampaignID   string    `json:"campaign_id"`
	OwnerID      string    `json:"owner_id"`
	OwnerName    string    `json:"owner_name"`
	Title        string    `json:"title"`
	Body         string    `json:"body"`
	Category     string    `json:"category"`   // Diario | Pista | Lore | PNJ | Misión
	Visibility   string    `json:"visibility"` // PRIVATE | GM_SHARED | CAMPAIGN | SELECTED_USERS
	RecipientIDs []string  `json:"recipient_ids"`
	AllowEdit    bool      `json:"allow_edit"`
	Version      int       `json:"version"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ChatMessage represents a persisted real-time tabletop chat message or whisper.
type ChatMessage struct {
	ID           string    `json:"id"`
	CampaignID   string    `json:"campaign_id"`
	SessionID    string    `json:"session_id"`
	AuthorID     string    `json:"author_id"`
	AuthorName   string    `json:"author_name"`
	AuthorRole   string    `json:"author_role"`
	AuthorColor  string    `json:"author_color"`
	Body         string    `json:"body"`
	Visibility   string    `json:"visibility"` // CAMPAIGN | GM_WHISPER | SELECTED_USERS
	RecipientIDs []string  `json:"recipient_ids"`
	CommandID    string    `json:"command_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// RollTableEntry represents a weighted outcome inside a RollTable.
type RollTableEntry struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Weight int    `json:"weight"`
	Detail string `json:"detail,omitempty"`
}

// RollTable is a weighted random table owned by a Campaign.
type RollTable struct {
	ID          string           `json:"id"`
	CampaignID  string           `json:"campaign_id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Entries     []RollTableEntry `json:"entries"`
	CreatedAt   time.Time        `json:"created_at"`
}

// RollTableResult captures one cryptographic random draw from a RollTable.
type RollTableResult struct {
	TableID   string         `json:"table_id"`
	TableName string         `json:"table_name"`
	Entry     RollTableEntry `json:"entry"`
	Roll      int            `json:"roll"`
	MaxWeight int            `json:"max_weight"`
}

// AuditEvent logs administrative actions (campaign switches, revocations, moderation, backups).
type AuditEvent struct {
	ID         int64     `json:"id"`
	CampaignID string    `json:"campaign_id"`
	ActorID    string    `json:"actor_id"`
	ActorName  string    `json:"actor_name"`
	Action     string    `json:"action"`
	Summary    string    `json:"summary"`
	CreatedAt  time.Time `json:"created_at"`
}

// NormalizeRollVisibility normalizes supported roll audience modes.
func NormalizeRollVisibility(v string) string {
	switch strings.ToUpper(strings.TrimSpace(v)) {
	case "GM_ONLY":
		return "GM_ONLY"
	case "ROLLER_AND_GM":
		return "ROLLER_AND_GM"
	case "ROLLER_ONLY":
		return "ROLLER_ONLY"
	default:
		return "PUBLIC"
	}
}

// NormalizeNoteVisibility normalizes supported journal note audience modes.
func NormalizeNoteVisibility(v string) string {
	switch strings.ToUpper(strings.TrimSpace(v)) {
	case "GM_SHARED":
		return "GM_SHARED"
	case "CAMPAIGN":
		return "CAMPAIGN"
	case "SELECTED_USERS":
		return "SELECTED_USERS"
	default:
		return "PRIVATE"
	}
}

// NormalizeChatVisibility normalizes supported chat audience modes.
func NormalizeChatVisibility(v string) string {
	switch strings.ToUpper(strings.TrimSpace(v)) {
	case "GM_WHISPER":
		return "GM_WHISPER"
	case "SELECTED_USERS":
		return "SELECTED_USERS"
	default:
		return "CAMPAIGN"
	}
}

// CanViewScopedItem evaluates server-side audience isolation for rolls/log entries.
func CanViewScopedItem(visibility, ownerID, viewerID string, isDM bool) bool {
	switch strings.ToUpper(strings.TrimSpace(visibility)) {
	case "", "PUBLIC", "CAMPAIGN":
		return true
	case "GM_ONLY":
		return isDM
	case "ROLLER_AND_GM", "GM_SHARED":
		return isDM || (viewerID != "" && ownerID == viewerID)
	case "ROLLER_ONLY", "PRIVATE":
		if viewerID != "" && ownerID == viewerID {
			return true
		}
		return isDM && (ownerID == "dm" || ownerID == "")
	default:
		return false
	}
}

func containsID(ids []string, target string) bool {
	if target == "" {
		return false
	}
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}

func canReadNote(n CampaignNote, viewerID string, isDM bool) bool {
	switch strings.ToUpper(n.Visibility) {
	case "CAMPAIGN":
		return true
	case "GM_SHARED":
		return isDM || (viewerID != "" && n.OwnerID == viewerID) || containsID(n.RecipientIDs, viewerID)
	case "SELECTED_USERS":
		return isDM || (viewerID != "" && (n.OwnerID == viewerID || containsID(n.RecipientIDs, viewerID)))
	default: // PRIVATE
		if viewerID != "" && n.OwnerID == viewerID {
			return true
		}
		return isDM && n.OwnerID == "dm"
	}
}

func canEditNote(n CampaignNote, actorID string, isDM bool) bool {
	if actorID != "" && n.OwnerID == actorID {
		return true
	}
	if isDM && strings.ToUpper(n.Visibility) != "PRIVATE" {
		return true
	}
	if isDM && n.OwnerID == "dm" {
		return true
	}
	return n.AllowEdit && canReadNote(n, actorID, isDM)
}

func canReadChat(m ChatMessage, viewerID string, isDM bool) bool {
	switch strings.ToUpper(m.Visibility) {
	case "GM_WHISPER":
		return isDM || (viewerID != "" && m.AuthorID == viewerID)
	case "SELECTED_USERS":
		return isDM || (viewerID != "" && (m.AuthorID == viewerID || containsID(m.RecipientIDs, viewerID)))
	default:
		return true
	}
}

func (s *Store) ensureCompanionDefaults() error {
	_, err := s.db.Exec(`
		INSERT OR IGNORE INTO campaigns (id, name, description, system_name, status)
		VALUES ('default', 'Crónicas de Rollhaven', 'Campaña principal en red local administrada con el estándar Rollhaven.', 'D&D 5e / Universal', 'ACTIVE')
	`)
	if err != nil {
		return fmt.Errorf("ensure default campaign: %w", err)
	}

	var sessCount int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM campaign_sessions WHERE campaign_id = 'default'`).Scan(&sessCount); err != nil {
		return fmt.Errorf("count campaign_sessions: %w", err)
	}
	if sessCount == 0 {
		if _, err := s.db.Exec(`
			INSERT INTO campaign_sessions (id, campaign_id, title, status)
			VALUES ('session-1', 'default', 'Sesión 1 — Mesa Principal', 'ACTIVE')
		`); err != nil {
			return fmt.Errorf("seed campaign_sessions: %w", err)
		}
	}

	return s.seedDefaultRollTables("default")
}

func (s *Store) seedDefaultRollTables(campaignID string) error {
	var rtCount int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM roll_tables WHERE campaign_id = ?`, campaignID).Scan(&rtCount); err != nil {
		return err
	}
	if rtCount > 0 {
		return nil
	}

	seeds := []struct {
		id      string
		name    string
		desc    string
		entries []RollTableEntry
	}{
		{
			id:   "rt_loot_" + campaignID,
			name: "Botín de Mazmorra",
			desc: "Hallazgos rápidos en cofres, guardias o altares.",
			entries: []RollTableEntry{
				{ID: "e1", Label: "25 Monedas de Oro y gema menor", Weight: 35, Detail: "Valor estimado: 50 po"},
				{ID: "e2", Label: "Poción de Curación (2d4+2)", Weight: 25, Detail: "Acción para recuperar HP"},
				{ID: "e3", Label: "Pergamino de Conjuro (Nivel 1–2)", Weight: 20, Detail: "Magia arcana o divina"},
				{ID: "e4", Label: "Llave de hierro rúnica", Weight: 12, Detail: "Abre cámara o pasadizo sellado"},
				{ID: "e5", Label: "Objeto Mágico Poco Común (+1)", Weight: 8, Detail: "Reliquia de campaña"},
			},
		},
		{
			id:   "rt_enc_" + campaignID,
			name: "Encuentros del Camino",
			desc: "Eventos aleatorios de viaje o guardia nocturna.",
			entries: []RollTableEntry{
				{ID: "c1", Label: "Patrulla de 4 Goblins exploradores", Weight: 30, Detail: "Sigilo DC 13 para emboscada"},
				{ID: "c2", Label: "Caravana mercante pidiendo escolta", Weight: 25, Detail: "Información de rumores locales"},
				{ID: "c3", Label: "2 Huargos y 1 Ogro al acecho", Weight: 20, Detail: "Combate táctico de peligro medio"},
				{ID: "c4", Label: "Santuario antiguo con inscripción rúnica", Weight: 15, Detail: "Prueba de Arcanos o Religión DC 12"},
				{ID: "c5", Label: "Sombra alada cruzando entre las nubes", Weight: 10, Detail: "Presagio o encuentro épico"},
			},
		},
	}

	for _, seed := range seeds {
		raw, _ := json.Marshal(seed.entries)
		if _, err := s.db.Exec(`
			INSERT OR IGNORE INTO roll_tables (id, campaign_id, name, description, entries_json)
			VALUES (?, ?, ?, ?, ?)
		`, seed.id, campaignID, seed.name, seed.desc, string(raw)); err != nil {
			return err
		}
	}
	return nil
}

// GetActiveCampaignID returns the active campaign ID configured on the tabletop room.
func (s *Store) GetActiveCampaignID() string {
	var id string
	err := s.db.QueryRow(`SELECT COALESCE(NULLIF(active_campaign_id, ''), 'default') FROM sessions WHERE id = ?`, DefaultSessionID).Scan(&id)
	if err != nil || strings.TrimSpace(id) == "" {
		return "default"
	}
	return id
}

// GetActiveCampaign returns the currently active Campaign record.
func (s *Store) GetActiveCampaign() (Campaign, error) {
	id := s.GetActiveCampaignID()
	var c Campaign
	err := s.db.QueryRow(`
		SELECT id, name, description, system_name, status, created_at, updated_at
		FROM campaigns WHERE id = ?
	`, id).Scan(&c.ID, &c.Name, &c.Description, &c.SystemName, &c.Status, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		err = s.db.QueryRow(`
			SELECT id, name, description, system_name, status, created_at, updated_at
			FROM campaigns ORDER BY created_at ASC LIMIT 1
		`).Scan(&c.ID, &c.Name, &c.Description, &c.SystemName, &c.Status, &c.CreatedAt, &c.UpdatedAt)
	}
	return c, err
}

// ListCampaigns lists all stored campaigns (active first, archived below).
func (s *Store) ListCampaigns() ([]Campaign, error) {
	rows, err := s.db.Query(`
		SELECT id, name, description, system_name, status, created_at, updated_at
		FROM campaigns
		ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Campaign
	for rows.Next() {
		var c Campaign
		if err := rows.Scan(&c.ID, &c.Name, &c.Description, &c.SystemName, &c.Status, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []Campaign{}
	}
	return out, rows.Err()
}

// CreateCampaign creates a new Campaign with an initial active session and default roll tables.
func (s *Store) CreateCampaign(name, description, systemName string, activate bool) (Campaign, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Campaign{}, fmt.Errorf("el nombre de la campaña es obligatorio")
	}
	if strings.TrimSpace(systemName) == "" {
		systemName = "D&D 5e / Universal"
	}
	id := "camp_" + uuid.NewString()[:8]
	now := time.Now().UTC()
	_, err := s.db.Exec(`
		INSERT INTO campaigns (id, name, description, system_name, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
	`, id, name, strings.TrimSpace(description), strings.TrimSpace(systemName), now, now)
	if err != nil {
		return Campaign{}, err
	}

	sessID := "csess_" + uuid.NewString()[:8]
	_, _ = s.db.Exec(`
		INSERT INTO campaign_sessions (id, campaign_id, title, status, started_at, created_at)
		VALUES (?, ?, 'Sesión 1 — Inicio', 'ACTIVE', ?, ?)
	`, sessID, id, now, now)
	_ = s.seedDefaultRollTables(id)

	if activate {
		_ = s.SwitchCampaign(id)
	}
	return Campaign{
		ID:          id,
		Name:        name,
		Description: strings.TrimSpace(description),
		SystemName:  strings.TrimSpace(systemName),
		Status:      "ACTIVE",
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

// UpdateCampaign updates campaign metadata without losing its resources.
func (s *Store) UpdateCampaign(id, name, description, systemName string) error {
	var curName, curDesc, curSys string
	if err := s.db.QueryRow(`SELECT name, description, system_name FROM campaigns WHERE id = ?`, id).Scan(&curName, &curDesc, &curSys); err != nil {
		return err
	}
	if strings.TrimSpace(name) != "" {
		curName = strings.TrimSpace(name)
	}
	if description != "" {
		curDesc = strings.TrimSpace(description)
	}
	if strings.TrimSpace(systemName) != "" {
		curSys = strings.TrimSpace(systemName)
	}
	_, err := s.db.Exec(`
		UPDATE campaigns SET name = ?, description = ?, system_name = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, curName, curDesc, curSys, id)
	return err
}

// ArchiveCampaign marks a campaign ARCHIVED (refusing to archive if it's the only campaign, or switching to default).
func (s *Store) ArchiveCampaign(id string, archived bool) error {
	status := "ACTIVE"
	if archived {
		status = "ARCHIVED"
	}
	_, err := s.db.Exec(`UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, status, id)
	return err
}

// SwitchCampaign switches the active tabletop room to another campaign while preserving all campaign data.
func (s *Store) SwitchCampaign(id string) error {
	var exists int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM campaigns WHERE id = ?`, id).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return fmt.Errorf("campaña %q no encontrada", id)
	}
	_, err := s.db.Exec(`UPDATE sessions SET active_campaign_id = ? WHERE id = ?`, id, DefaultSessionID)
	return err
}

// ListCampaignSessions returns historical and active sessions for campaignID.
func (s *Store) ListCampaignSessions(campaignID string) ([]CampaignSession, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	rows, err := s.db.Query(`
		SELECT id, campaign_id, title, status, started_at, ended_at, created_at
		FROM campaign_sessions WHERE campaign_id = ?
		ORDER BY created_at DESC
	`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CampaignSession
	for rows.Next() {
		var cs CampaignSession
		var ended sql.NullTime
		if err := rows.Scan(&cs.ID, &cs.CampaignID, &cs.Title, &cs.Status, &cs.StartedAt, &ended, &cs.CreatedAt); err != nil {
			return nil, err
		}
		if ended.Valid {
			t := ended.Time
			cs.EndedAt = &t
		}
		out = append(out, cs)
	}
	if out == nil {
		out = []CampaignSession{}
	}
	return out, rows.Err()
}

// GetActiveCampaignSession returns the active or latest session ID for campaignID.
func (s *Store) GetActiveCampaignSessionID(campaignID string) string {
	var id string
	err := s.db.QueryRow(`
		SELECT id FROM campaign_sessions
		WHERE campaign_id = ? AND status IN ('ACTIVE', 'PAUSED')
		ORDER BY created_at DESC LIMIT 1
	`, campaignID).Scan(&id)
	if err != nil {
		return "session-1"
	}
	return id
}

// StartCampaignSession closes previous active sessions (if closing previous or creating a new one) and starts a new ACTIVE session.
func (s *Store) StartCampaignSession(campaignID, title string) (CampaignSession, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	if strings.TrimSpace(title) == "" {
		var count int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM campaign_sessions WHERE campaign_id = ?`, campaignID).Scan(&count)
		title = fmt.Sprintf("Sesión %d", count+1)
	}
	now := time.Now().UTC()
	_, _ = s.db.Exec(`
		UPDATE campaign_sessions SET status = 'CLOSED', ended_at = ?
		WHERE campaign_id = ? AND status IN ('ACTIVE', 'PAUSED')
	`, now, campaignID)

	id := "csess_" + uuid.NewString()[:8]
	_, err := s.db.Exec(`
		INSERT INTO campaign_sessions (id, campaign_id, title, status, started_at, created_at)
		VALUES (?, ?, ?, 'ACTIVE', ?, ?)
	`, id, campaignID, strings.TrimSpace(title), now, now)
	if err != nil {
		return CampaignSession{}, err
	}
	return CampaignSession{
		ID:         id,
		CampaignID: campaignID,
		Title:      strings.TrimSpace(title),
		Status:     "ACTIVE",
		StartedAt:  now,
		CreatedAt:  now,
	}, nil
}

// UpdateCampaignSessionStatus transitions a session between ACTIVE, PAUSED, and CLOSED without deleting campaign records.
func (s *Store) UpdateCampaignSessionStatus(sessionID, status string) error {
	status = strings.ToUpper(strings.TrimSpace(status))
	switch status {
	case "ACTIVE", "PAUSED", "CLOSED":
	default:
		return fmt.Errorf("estado de sesión inválido: %s", status)
	}
	if status == "CLOSED" {
		_, err := s.db.Exec(`UPDATE campaign_sessions SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?`, status, sessionID)
		return err
	}
	_, err := s.db.Exec(`UPDATE campaign_sessions SET status = ?, ended_at = NULL WHERE id = ?`, status, sessionID)
	return err
}

// SetPlayerMembership updates a participant's campaign role (GM/PLAYER) and status (ACTIVE/REVOKED).
func (s *Store) SetPlayerMembership(playerID, role, status string) error {
	p, err := s.GetPlayer(playerID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(role) != "" {
		upperRole := strings.ToUpper(strings.TrimSpace(role))
		if upperRole == "GM" || upperRole == "PLAYER" {
			p.Role = upperRole
		}
	}
	if strings.TrimSpace(status) != "" {
		upperStatus := strings.ToUpper(strings.TrimSpace(status))
		if upperStatus == "ACTIVE" || upperStatus == "REVOKED" {
			p.MembershipStatus = upperStatus
		}
	}
	_, err = s.db.Exec(`UPDATE players SET role = ?, membership_status = ? WHERE id = ?`, p.Role, p.MembershipStatus, playerID)
	return err
}

// CreateCampaignNote creates a structured note/journal entry with explicit audience rules.
func (s *Store) CreateCampaignNote(campaignID, ownerID, ownerName, title, body, category, visibility string, recipients []string, allowEdit bool) (CampaignNote, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return CampaignNote{}, fmt.Errorf("el título de la nota es obligatorio")
	}
	if strings.TrimSpace(category) == "" {
		category = "Diario"
	}
	visibility = NormalizeNoteVisibility(visibility)
	if recipients == nil {
		recipients = []string{}
	}
	recJSON, _ := json.Marshal(recipients)
	allowInt := 0
	if allowEdit {
		allowInt = 1
	}
	id := "note_" + uuid.NewString()[:8]
	now := time.Now().UTC()
	_, err := s.db.Exec(`
		INSERT INTO campaign_notes (id, campaign_id, owner_id, owner_name, title, body, category, visibility, recipients_json, allow_edit, version, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
	`, id, campaignID, ownerID, ownerName, title, body, category, visibility, string(recJSON), allowInt, now, now)
	if err != nil {
		return CampaignNote{}, err
	}
	return CampaignNote{
		ID:           id,
		CampaignID:   campaignID,
		OwnerID:      ownerID,
		OwnerName:    ownerName,
		Title:        title,
		Body:         body,
		Category:     category,
		Visibility:   visibility,
		RecipientIDs: recipients,
		AllowEdit:    allowEdit,
		Version:      1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}, nil
}

// GetCampaignNote fetches a single campaign note by ID.
func (s *Store) GetCampaignNote(noteID string) (CampaignNote, error) {
	var n CampaignNote
	var recStr string
	var allowInt int
	err := s.db.QueryRow(`
		SELECT id, campaign_id, owner_id, owner_name, title, body, category, visibility, recipients_json, allow_edit, version, created_at, updated_at
		FROM campaign_notes WHERE id = ?
	`, noteID).Scan(
		&n.ID, &n.CampaignID, &n.OwnerID, &n.OwnerName, &n.Title, &n.Body,
		&n.Category, &n.Visibility, &recStr, &allowInt, &n.Version, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		return CampaignNote{}, err
	}
	_ = json.Unmarshal([]byte(recStr), &n.RecipientIDs)
	if n.RecipientIDs == nil {
		n.RecipientIDs = []string{}
	}
	n.AllowEdit = allowInt != 0
	return n, nil
}

// UpdateCampaignNote updates a note after validating read/edit permissions and optimistic version.
func (s *Store) UpdateCampaignNote(noteID, actorID string, isDM bool, expectedVersion int, title, body, category, visibility string, recipients []string, allowEdit *bool) (CampaignNote, error) {
	cur, err := s.GetCampaignNote(noteID)
	if err != nil {
		return CampaignNote{}, err
	}
	if !canEditNote(cur, actorID, isDM) {
		return CampaignNote{}, fmt.Errorf("no tienes permiso para editar esta nota")
	}
	if expectedVersion > 0 && expectedVersion != cur.Version {
		return CampaignNote{}, fmt.Errorf("%w (tu versión: v%d, actual: v%d)", ErrVersionConflict, expectedVersion, cur.Version)
	}

	if strings.TrimSpace(title) != "" {
		cur.Title = strings.TrimSpace(title)
	}
	cur.Body = body
	if strings.TrimSpace(category) != "" {
		cur.Category = strings.TrimSpace(category)
	}
	if strings.TrimSpace(visibility) != "" && (cur.OwnerID == actorID || isDM) {
		cur.Visibility = NormalizeNoteVisibility(visibility)
	}
	if recipients != nil && (cur.OwnerID == actorID || isDM) {
		cur.RecipientIDs = recipients
	}
	if allowEdit != nil && (cur.OwnerID == actorID || isDM) {
		cur.AllowEdit = *allowEdit
	}
	recJSON, _ := json.Marshal(cur.RecipientIDs)
	allowInt := 0
	if cur.AllowEdit {
		allowInt = 1
	}

	res, err := s.db.Exec(`
		UPDATE campaign_notes
		SET title = ?, body = ?, category = ?, visibility = ?, recipients_json = ?, allow_edit = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND version = ?
	`, cur.Title, cur.Body, cur.Category, cur.Visibility, string(recJSON), allowInt, noteID, cur.Version)
	if err != nil {
		return CampaignNote{}, err
	}
	aff, _ := res.RowsAffected()
	if aff == 0 {
		return CampaignNote{}, ErrVersionConflict
	}
	return s.GetCampaignNote(noteID)
}

// DeleteCampaignNote deletes a note if the caller is owner or authorized DM.
func (s *Store) DeleteCampaignNote(noteID, actorID string, isDM bool) error {
	cur, err := s.GetCampaignNote(noteID)
	if err != nil {
		return err
	}
	isOwner := (actorID != "" && cur.OwnerID == actorID) || (isDM && cur.OwnerID == "dm")
	if !isOwner && !(isDM && strings.ToUpper(cur.Visibility) != "PRIVATE") {
		return fmt.Errorf("no tienes permiso para eliminar esta nota")
	}
	_, err = s.db.Exec(`DELETE FROM campaign_notes WHERE id = ?`, noteID)
	return err
}

// ListCampaignNotesForViewer returns only the notes authorized for viewerID / isDM in campaignID.
func (s *Store) ListCampaignNotesForViewer(campaignID, viewerID string, isDM bool) ([]CampaignNote, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	rows, err := s.db.Query(`
		SELECT id, campaign_id, owner_id, owner_name, title, body, category, visibility, recipients_json, allow_edit, version, created_at, updated_at
		FROM campaign_notes WHERE campaign_id = ?
		ORDER BY updated_at DESC, created_at DESC
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
		if canReadNote(n, viewerID, isDM) {
			out = append(out, n)
		}
	}
	if out == nil {
		out = []CampaignNote{}
	}
	return out, rows.Err()
}

// AppendChatMessage persists a chat message or private whisper.
func (s *Store) AppendChatMessage(campaignID, sessionID, authorID, authorName, authorRole, authorColor, body, visibility string, recipients []string, commandID string) (ChatMessage, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	if strings.TrimSpace(sessionID) == "" {
		sessionID = s.GetActiveCampaignSessionID(campaignID)
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return ChatMessage{}, fmt.Errorf("el mensaje no puede estar vacío")
	}
	visibility = NormalizeChatVisibility(visibility)
	if recipients == nil {
		recipients = []string{}
	}
	recJSON, _ := json.Marshal(recipients)
	id := "msg_" + uuid.NewString()[:8]
	now := time.Now().UTC()
	_, err := s.db.Exec(`
		INSERT INTO chat_messages (id, campaign_id, session_id, author_id, author_name, author_role, author_color, body, visibility, recipients_json, command_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, campaignID, sessionID, authorID, authorName, authorRole, authorColor, body, visibility, string(recJSON), commandID, now)
	if err != nil {
		return ChatMessage{}, err
	}
	return ChatMessage{
		ID:           id,
		CampaignID:   campaignID,
		SessionID:    sessionID,
		AuthorID:     authorID,
		AuthorName:   authorName,
		AuthorRole:   authorRole,
		AuthorColor:  authorColor,
		Body:         body,
		Visibility:   visibility,
		RecipientIDs: recipients,
		CommandID:    commandID,
		CreatedAt:    now,
	}, nil
}

// ListChatMessagesForViewer returns visible chat messages for viewerID/isDM in chronological order.
func (s *Store) ListChatMessagesForViewer(campaignID, viewerID string, isDM bool, limit int) ([]ChatMessage, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(`
		SELECT id, campaign_id, session_id, author_id, author_name, author_role, author_color, body, visibility, recipients_json, COALESCE(command_id, ''), created_at
		FROM chat_messages WHERE campaign_id = ?
		ORDER BY created_at DESC
		LIMIT ?
	`, campaignID, limit*2)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var filteredDesc []ChatMessage
	for rows.Next() {
		var m ChatMessage
		var recStr string
		if err := rows.Scan(
			&m.ID, &m.CampaignID, &m.SessionID, &m.AuthorID, &m.AuthorName, &m.AuthorRole,
			&m.AuthorColor, &m.Body, &m.Visibility, &recStr, &m.CommandID, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(recStr), &m.RecipientIDs)
		if m.RecipientIDs == nil {
			m.RecipientIDs = []string{}
		}
		if canReadChat(m, viewerID, isDM) {
			filteredDesc = append(filteredDesc, m)
			if len(filteredDesc) >= limit {
				break
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Reverse to chronological ascending for UI chat feed
	out := make([]ChatMessage, 0, len(filteredDesc))
	for i := len(filteredDesc) - 1; i >= 0; i-- {
		out = append(out, filteredDesc[i])
	}
	return out, nil
}

// DeleteChatMessage removes a moderated message from chat history.
func (s *Store) DeleteChatMessage(id string) error {
	_, err := s.db.Exec(`DELETE FROM chat_messages WHERE id = ?`, id)
	return err
}

// ListRollTables lists weighted random tables for campaignID.
func (s *Store) ListRollTables(campaignID string) ([]RollTable, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	rows, err := s.db.Query(`
		SELECT id, campaign_id, name, description, entries_json, created_at
		FROM roll_tables WHERE campaign_id = ?
		ORDER BY created_at ASC
	`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RollTable
	for rows.Next() {
		var rt RollTable
		var raw string
		if err := rows.Scan(&rt.ID, &rt.CampaignID, &rt.Name, &rt.Description, &raw, &rt.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &rt.Entries)
		if rt.Entries == nil {
			rt.Entries = []RollTableEntry{}
		}
		out = append(out, rt)
	}
	if out == nil {
		out = []RollTable{}
	}
	return out, rows.Err()
}

// CreateRollTable creates a custom weighted random table in campaignID.
func (s *Store) CreateRollTable(campaignID, name, description string, entries []RollTableEntry) (RollTable, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return RollTable{}, fmt.Errorf("el nombre de la tabla es obligatorio")
	}
	clean := make([]RollTableEntry, 0, len(entries))
	for i, e := range entries {
		lbl := strings.TrimSpace(e.Label)
		if lbl == "" {
			continue
		}
		w := e.Weight
		if w < 1 {
			w = 1
		}
		id := e.ID
		if strings.TrimSpace(id) == "" {
			id = fmt.Sprintf("e%d", i+1)
		}
		clean = append(clean, RollTableEntry{ID: id, Label: lbl, Weight: w, Detail: strings.TrimSpace(e.Detail)})
	}
	if len(clean) == 0 {
		return RollTable{}, fmt.Errorf("la tabla debe tener al menos una entrada válida")
	}

	raw, _ := json.Marshal(clean)
	id := "rt_" + uuid.NewString()[:8]
	now := time.Now().UTC()
	_, err := s.db.Exec(`
		INSERT INTO roll_tables (id, campaign_id, name, description, entries_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, campaignID, name, strings.TrimSpace(description), string(raw), now)
	if err != nil {
		return RollTable{}, err
	}
	return RollTable{
		ID:          id,
		CampaignID:  campaignID,
		Name:        name,
		Description: strings.TrimSpace(description),
		Entries:     clean,
		CreatedAt:   now,
	}, nil
}

// DeleteRollTable deletes a RollTable by ID.
func (s *Store) DeleteRollTable(tableID string) error {
	_, err := s.db.Exec(`DELETE FROM roll_tables WHERE id = ?`, tableID)
	return err
}

// ExecuteRollTable evaluates a RollTable securely using crypto/rand proportional to entry weights.
func (s *Store) ExecuteRollTable(tableID string) (RollTableResult, error) {
	var rt RollTable
	var raw string
	err := s.db.QueryRow(`
		SELECT id, campaign_id, name, description, entries_json, created_at
		FROM roll_tables WHERE id = ?
	`, tableID).Scan(&rt.ID, &rt.CampaignID, &rt.Name, &rt.Description, &raw, &rt.CreatedAt)
	if err != nil {
		return RollTableResult{}, fmt.Errorf("tabla no encontrada: %w", err)
	}
	_ = json.Unmarshal([]byte(raw), &rt.Entries)
	totalWeight := 0
	for _, e := range rt.Entries {
		w := e.Weight
		if w < 1 {
			w = 1
		}
		totalWeight += w
	}
	if totalWeight == 0 {
		return RollTableResult{}, fmt.Errorf("la tabla no tiene entradas evaluables")
	}

	roll, err := engine.CryptoRandInt(1, totalWeight)
	if err != nil {
		return RollTableResult{}, err
	}
	acc := 0
	chosen := rt.Entries[0]
	for _, e := range rt.Entries {
		w := e.Weight
		if w < 1 {
			w = 1
		}
		acc += w
		if roll <= acc {
			chosen = e
			break
		}
	}
	return RollTableResult{
		TableID:   rt.ID,
		TableName: rt.Name,
		Entry:     chosen,
		Roll:      roll,
		MaxWeight: totalWeight,
	}, nil
}

// AppendAuditEvent records a sensitive/administrative operation without storing private secrets.
func (s *Store) AppendAuditEvent(campaignID, actorID, actorName, action, summary string) error {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	_, err := s.db.Exec(`
		INSERT INTO audit_events (campaign_id, actor_id, actor_name, action, summary)
		VALUES (?, ?, ?, ?, ?)
	`, campaignID, actorID, actorName, action, summary)
	return err
}

// ListAuditEvents retrieves recent audit entries for campaignID (newest first).
func (s *Store) ListAuditEvents(campaignID string, limit int) ([]AuditEvent, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`
		SELECT id, campaign_id, actor_id, actor_name, action, summary, created_at
		FROM audit_events WHERE campaign_id = ?
		ORDER BY id DESC LIMIT ?
	`, campaignID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AuditEvent
	for rows.Next() {
		var ev AuditEvent
		if err := rows.Scan(&ev.ID, &ev.CampaignID, &ev.ActorID, &ev.ActorName, &ev.Action, &ev.Summary, &ev.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ev)
	}
	if out == nil {
		out = []AuditEvent{}
	}
	return out, rows.Err()
}

// CheckCommandIdempotency checks if commandID has already been processed and returns its stored JSON payload.
func (s *Store) CheckCommandIdempotency(commandID string) (json.RawMessage, bool) {
	commandID = strings.TrimSpace(commandID)
	if commandID == "" {
		return nil, false
	}
	var raw string
	err := s.db.QueryRow(`SELECT result_json FROM processed_commands WHERE command_id = ?`, commandID).Scan(&raw)
	if err != nil {
		return nil, false
	}
	return json.RawMessage(raw), true
}

// SaveCommandIdempotency records a processed commandId so retries remain idempotent.
func (s *Store) SaveCommandIdempotency(commandID, actorID, commandType string, result any) {
	commandID = strings.TrimSpace(commandID)
	if commandID == "" {
		return
	}
	b, _ := json.Marshal(result)
	_, _ = s.db.Exec(`
		INSERT OR IGNORE INTO processed_commands (command_id, actor_id, command_type, result_json)
		VALUES (?, ?, ?, ?)
	`, commandID, actorID, commandType, string(b))
}
