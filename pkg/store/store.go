package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/SilverFeit/Rollhaven/pkg/engine"
	"github.com/google/uuid"
)

const DefaultSessionID = "default-session"

// Session represents the active tabletop room and tactical map settings.
type Session struct {
	ID               string    `json:"id"`
	CreatedAt        time.Time `json:"created_at"`
	IsActive         bool      `json:"is_active"`
	MapEnabled       bool      `json:"map_enabled"`
	MapRows          int       `json:"map_rows"`
	MapCols          int       `json:"map_cols"`
	MapImagePath     string    `json:"map_image_path"`
	MapGridColor     string    `json:"map_grid_color"`
	MapGridOpacity   float64   `json:"map_grid_opacity"`
	CurrentTurnIndex int       `json:"current_turn_index"`
}

// Player represents a joined player or character token in the session.
type Player struct {
	ID                 string          `json:"id"`
	SessionID          string          `json:"session_id"`
	Name               string          `json:"name"`
	Initiative         int             `json:"initiative"`
	RaceIcon           string          `json:"race_icon"`
	ColorHex           string          `json:"color_hex"`
	CharacterSheetPath string          `json:"character_sheet_path"`
	TokenX             int             `json:"token_x"`
	TokenY             int             `json:"token_y"`
	TokenHidden        bool            `json:"token_hidden"`
	TurnOrder          int             `json:"turn_order"`
	ManualOrder        bool            `json:"manual_order"`
	IsConnected        bool            `json:"is_connected"`
	ClientIP           string          `json:"client_ip"`
	UserAgent          string          `json:"user_agent"`
	LatencyMS          int             `json:"latency_ms"`
	CreatedAt          time.Time       `json:"created_at"`
	LastSeen           time.Time       `json:"last_seen"`
	Inventory          []InventoryItem `json:"inventory,omitempty"`
	Notes              string          `json:"notes,omitempty"`
}

// InventoryItem represents an item carried by a player.
type InventoryItem struct {
	ID          string `json:"id"`
	PlayerID    string `json:"player_id"`
	Name        string `json:"name"`
	Quantity    int    `json:"quantity"`
	Description string `json:"description"`
}

// ActionLogEntry represents a persisted roll, decision, or game event.
type ActionLogEntry struct {
	ID         int64           `json:"id"`
	SessionID  string          `json:"session_id"`
	PlayerID   string          `json:"player_id"`
	PlayerName string          `json:"player_name"`
	ActionType string          `json:"action_type"`
	Details    string          `json:"details"`
	ResultJSON json.RawMessage `json:"result_json"`
	CreatedAt  time.Time       `json:"created_at"`
}

// MapEntity represents an enemy, trap, item, NPC, hazard, or interactive point placed by the DM on the tactical map.
type MapEntity struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	Kind      string    `json:"kind"` // enemy | trap | item | npc | hazard | door
	Name      string    `json:"name"`
	X         int       `json:"x"`
	Y         int       `json:"y"`
	Size      int       `json:"size"` // 1 (1x1), 2 (2x2), 3 (3x3)
	ColorHex  string    `json:"color_hex"`
	HPCurrent int       `json:"hp_current"`
	HPMax     int       `json:"hp_max"`
	Note      string    `json:"note"`
	IsHidden  bool      `json:"is_hidden"`
	CreatedAt time.Time `json:"created_at"`
}

// Store wraps all SQLite reads and writes for Rollhaven.
type Store struct {
	db *sql.DB
}

// New creates a Store backed by db and ensures the default session and DM note row exist.
func New(db *sql.DB) (*Store, error) {
	s := &Store{db: db}
	if err := s.ensureDefaults(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) ensureDefaults() error {
	_, err := s.db.Exec(`
		INSERT OR IGNORE INTO sessions (id, is_active, map_enabled, map_rows, map_cols, map_image_path, map_grid_color, map_grid_opacity, current_turn_index)
		VALUES (?, 1, 0, 10, 10, '', '#ffffff', 0.35, 0)
	`, DefaultSessionID)
	if err != nil {
		return fmt.Errorf("ensure default session: %w", err)
	}

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM dm_notes`).Scan(&count); err != nil {
		return fmt.Errorf("count dm_notes: %w", err)
	}
	if count == 0 {
		if _, err := s.db.Exec(`INSERT INTO dm_notes (id, content) VALUES (1, '')`); err != nil {
			return fmt.Errorf("init dm_notes: %w", err)
		}
	}
	return nil
}

// GetSession loads the active session configuration.
func (s *Store) GetSession() (Session, error) {
	var sess Session
	var isActive, mapEnabled int
	err := s.db.QueryRow(`
		SELECT id, created_at, is_active, map_enabled, map_rows, map_cols, map_image_path, map_grid_color, map_grid_opacity, current_turn_index
		FROM sessions WHERE id = ?
	`, DefaultSessionID).Scan(
		&sess.ID, &sess.CreatedAt, &isActive, &mapEnabled,
		&sess.MapRows, &sess.MapCols, &sess.MapImagePath,
		&sess.MapGridColor, &sess.MapGridOpacity, &sess.CurrentTurnIndex,
	)
	if err != nil {
		return Session{}, fmt.Errorf("get session: %w", err)
	}
	sess.IsActive = isActive != 0
	sess.MapEnabled = mapEnabled != 0
	return sess, nil
}

// UpdateCurrentTurnIndex persists the active turn index.
func (s *Store) UpdateCurrentTurnIndex(idx int) error {
	if idx < 0 {
		idx = 0
	}
	_, err := s.db.Exec(`UPDATE sessions SET current_turn_index = ? WHERE id = ?`, idx, DefaultSessionID)
	return err
}

// UpdateMapConfig updates tactical map settings clamped to 5..50 grid cells.
func (s *Store) UpdateMapConfig(enabled bool, rows, cols int, gridColor string, gridOpacity float64) (Session, error) {
	if rows < 5 {
		rows = 5
	} else if rows > 50 {
		rows = 50
	}
	if cols < 5 {
		cols = 5
	} else if cols > 50 {
		cols = 50
	}
	if strings.TrimSpace(gridColor) == "" {
		gridColor = "#ffffff"
	}
	if gridOpacity < 0.05 {
		gridOpacity = 0.05
	} else if gridOpacity > 0.9 {
		gridOpacity = 0.9
	}

	en := 0
	if enabled {
		en = 1
	}

	_, err := s.db.Exec(`
		UPDATE sessions
		SET map_enabled = ?, map_rows = ?, map_cols = ?, map_grid_color = ?, map_grid_opacity = ?
		WHERE id = ?
	`, en, rows, cols, gridColor, gridOpacity, DefaultSessionID)
	if err != nil {
		return Session{}, err
	}

	// Clamp all player tokens and map entities inside the new bounds
	_, _ = s.db.Exec(`
		UPDATE players
		SET token_x = CASE WHEN token_x >= ? THEN ? ELSE token_x END,
		    token_y = CASE WHEN token_y >= ? THEN ? ELSE token_y END
		WHERE session_id = ?
	`, cols, cols-1, rows, rows-1, DefaultSessionID)
	_, _ = s.db.Exec(`
		UPDATE map_entities
		SET x = CASE WHEN x >= ? THEN ? ELSE x END,
		    y = CASE WHEN y >= ? THEN ? ELSE y END
		WHERE session_id = ?
	`, cols, cols-1, rows, rows-1, DefaultSessionID)

	return s.GetSession()
}

// SetMapImagePath stores the uploaded background map image URL path.
func (s *Store) SetMapImagePath(path string) error {
	_, err := s.db.Exec(`UPDATE sessions SET map_image_path = ? WHERE id = ?`, path, DefaultSessionID)
	return err
}

// UpsertPlayer registers a new player or rehydrates/updates an existing one by ID.
func (s *Store) UpsertPlayer(id, name string, initiative int, raceIcon, colorHex, clientIP, userAgent string) (Player, error) {
	if strings.TrimSpace(id) == "" {
		id = "usr_" + uuid.NewString()[:8]
	}
	if strings.TrimSpace(name) == "" {
		name = "Aventurero"
	}
	if strings.TrimSpace(raceIcon) == "" {
		raceIcon = "human"
	}
	if strings.TrimSpace(colorHex) == "" {
		colorHex = "#a855f7"
	}

	var exists int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM players WHERE id = ?`, id).Scan(&exists); err != nil {
		return Player{}, err
	}

	if exists == 0 {
		// Place initial token neatly across early cells based on player count.
		var count int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM players WHERE session_id = ?`, DefaultSessionID).Scan(&count)
		sess, _ := s.GetSession()
		cols := sess.MapCols
		if cols < 5 {
			cols = 10
		}
		rows := sess.MapRows
		if rows < 5 {
			rows = 10
		}
		tx := count % cols
		ty := (count / cols) % rows

		now := time.Now().UTC()
		_, err := s.db.Exec(`
			INSERT INTO players (
				id, session_id, name, initiative, race_icon, color_hex,
				token_x, token_y, is_connected, client_ip, user_agent, created_at, last_seen
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
		`, id, DefaultSessionID, name, initiative, raceIcon, colorHex, tx, ty, clientIP, userAgent, now, now)
		if err != nil {
			return Player{}, fmt.Errorf("insert player: %w", err)
		}
		_, _ = s.db.Exec(`INSERT OR IGNORE INTO player_notes (player_id, content) VALUES (?, '')`, id)
	} else {
		_, err := s.db.Exec(`
			UPDATE players
			SET name = ?, initiative = ?, race_icon = ?, color_hex = ?,
			    is_connected = 1, client_ip = ?, user_agent = ?, last_seen = ?
			WHERE id = ?
		`, name, initiative, raceIcon, colorHex, clientIP, userAgent, time.Now().UTC(), id)
		if err != nil {
			return Player{}, fmt.Errorf("update player: %w", err)
		}
	}

	return s.GetPlayer(id)
}

// UpdatePlayerProfile updates mutable profile fields without resetting turn placement unless initiative changed.
func (s *Store) UpdatePlayerProfile(id, name string, initiative *int, raceIcon, colorHex string) (Player, error) {
	p, err := s.GetPlayer(id)
	if err != nil {
		return Player{}, err
	}
	if strings.TrimSpace(name) != "" {
		p.Name = strings.TrimSpace(name)
	}
	if initiative != nil {
		p.Initiative = *initiative
	}
	if strings.TrimSpace(raceIcon) != "" {
		p.RaceIcon = strings.TrimSpace(raceIcon)
	}
	if strings.TrimSpace(colorHex) != "" {
		p.ColorHex = strings.TrimSpace(colorHex)
	}

	_, err = s.db.Exec(`
		UPDATE players
		SET name = ?, initiative = ?, race_icon = ?, color_hex = ?, last_seen = CURRENT_TIMESTAMP
		WHERE id = ?
	`, p.Name, p.Initiative, p.RaceIcon, p.ColorHex, id)
	if err != nil {
		return Player{}, err
	}
	return s.GetPlayer(id)
}

// SetPlayerConnection updates connection status, IP, User-Agent, and latency.
func (s *Store) SetPlayerConnection(id string, connected bool, clientIP, userAgent string, latencyMS int) error {
	conn := 0
	if connected {
		conn = 1
	}
	_, err := s.db.Exec(`
		UPDATE players
		SET is_connected = ?,
		    client_ip = CASE WHEN ? != '' THEN ? ELSE client_ip END,
		    user_agent = CASE WHEN ? != '' THEN ? ELSE user_agent END,
		    latency_ms = CASE WHEN ? >= 0 THEN ? ELSE latency_ms END,
		    last_seen = CURRENT_TIMESTAMP
		WHERE id = ?
	`, conn, clientIP, clientIP, userAgent, userAgent, latencyMS, latencyMS, id)
	return err
}

// GetPlayer fetches a single player along with their inventory and personal notes.
func (s *Store) GetPlayer(id string) (Player, error) {
	var p Player
	var tokenHidden, manualOrder, isConnected int
	err := s.db.QueryRow(`
		SELECT id, session_id, name, initiative, race_icon, color_hex,
		       character_sheet_path, token_x, token_y, token_hidden,
		       turn_order, manual_order, is_connected, client_ip, user_agent,
		       latency_ms, created_at, last_seen
		FROM players WHERE id = ?
	`, id).Scan(
		&p.ID, &p.SessionID, &p.Name, &p.Initiative, &p.RaceIcon, &p.ColorHex,
		&p.CharacterSheetPath, &p.TokenX, &p.TokenY, &tokenHidden,
		&p.TurnOrder, &manualOrder, &isConnected, &p.ClientIP, &p.UserAgent,
		&p.LatencyMS, &p.CreatedAt, &p.LastSeen,
	)
	if err != nil {
		return Player{}, err
	}
	p.TokenHidden = tokenHidden != 0
	p.ManualOrder = manualOrder != 0
	p.IsConnected = isConnected != 0
	p.Inventory, _ = s.ListInventory(p.ID)
	p.Notes, _ = s.GetPlayerNotes(p.ID)
	return p, nil
}

// ListPlayersOrdered returns all session players sorted via the turn engine.
func (s *Store) ListPlayersOrdered() ([]Player, error) {
	rows, err := s.db.Query(`
		SELECT id, session_id, name, initiative, race_icon, color_hex,
		       character_sheet_path, token_x, token_y, token_hidden,
		       turn_order, manual_order, is_connected, client_ip, user_agent,
		       latency_ms, created_at, last_seen
		FROM players WHERE session_id = ?
	`, DefaultSessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := make(map[string]Player)
	var turnInputs []engine.TurnPlayer
	for rows.Next() {
		var p Player
		var tokenHidden, manualOrder, isConnected int
		if err := rows.Scan(
			&p.ID, &p.SessionID, &p.Name, &p.Initiative, &p.RaceIcon, &p.ColorHex,
			&p.CharacterSheetPath, &p.TokenX, &p.TokenY, &tokenHidden,
			&p.TurnOrder, &manualOrder, &isConnected, &p.ClientIP, &p.UserAgent,
			&p.LatencyMS, &p.CreatedAt, &p.LastSeen,
		); err != nil {
			return nil, err
		}
		p.TokenHidden = tokenHidden != 0
		p.ManualOrder = manualOrder != 0
		p.IsConnected = isConnected != 0
		byID[p.ID] = p
		turnInputs = append(turnInputs, engine.TurnPlayer{
			ID:          p.ID,
			Name:        p.Name,
			Initiative:  p.Initiative,
			TurnOrder:   p.TurnOrder,
			ManualOrder: p.ManualOrder,
			CreatedAt:   p.CreatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sorted := engine.SortPlayersForTurnOrder(turnInputs)
	out := make([]Player, 0, len(sorted))
	for _, tp := range sorted {
		p := byID[tp.ID]
		p.Inventory, _ = s.ListInventory(p.ID)
		out = append(out, p)
	}
	return out, nil
}

// SetPlayerInitiative updates a player's initiative and clears manual override so initiative order applies.
func (s *Store) SetPlayerInitiative(playerID string, initiative int) error {
	_, err := s.db.Exec(`
		UPDATE players SET initiative = ?, manual_order = 0 WHERE id = ?
	`, initiative, playerID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE players SET manual_order = 0 WHERE session_id = ?`, DefaultSessionID)
	return err
}

// ReorderPlayers applies explicit DM drag-and-drop turn ordering across player IDs.
func (s *Store) ReorderPlayers(orderedIDs []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for i, id := range orderedIDs {
		if _, err := tx.Exec(`UPDATE players SET turn_order = ?, manual_order = 1 WHERE id = ?`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeletePlayer removes a player from the session (used when DM kicks a duplicate or absent player).
func (s *Store) DeletePlayer(playerID string) error {
	_, err := s.db.Exec(`DELETE FROM players WHERE id = ?`, playerID)
	return err
}

// SetCharacterSheetPath stores the uploaded sheet path for a player.
func (s *Store) SetCharacterSheetPath(playerID, path string) error {
	_, err := s.db.Exec(`UPDATE players SET character_sheet_path = ? WHERE id = ?`, path, playerID)
	return err
}

// MoveToken moves a player's token within validated grid bounds.
func (s *Store) MoveToken(playerID string, x, y int) error {
	sess, err := s.GetSession()
	if err != nil {
		return err
	}
	if x < 0 || x >= sess.MapCols || y < 0 || y >= sess.MapRows {
		return fmt.Errorf("coordenadas fuera del mapa (%d, %d) para grilla %dx%d", x, y, sess.MapCols, sess.MapRows)
	}
	_, err = s.db.Exec(`UPDATE players SET token_x = ?, token_y = ? WHERE id = ?`, x, y, playerID)
	return err
}

// ToggleTokenVisibility toggles or sets whether a player's token is hidden on the tactical map.
func (s *Store) ToggleTokenVisibility(playerID string, hidden bool) error {
	h := 0
	if hidden {
		h = 1
	}
	_, err := s.db.Exec(`UPDATE players SET token_hidden = ? WHERE id = ?`, h, playerID)
	return err
}

// ResetTokens resets all players' tokens back to starting row/col positions and reveals them.
func (s *Store) ResetTokens() error {
	players, err := s.ListPlayersOrdered()
	if err != nil {
		return err
	}
	sess, err := s.GetSession()
	if err != nil {
		return err
	}
	cols := sess.MapCols
	if cols < 1 {
		cols = 10
	}
	rows := sess.MapRows
	if rows < 1 {
		rows = 10
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, p := range players {
		x := i % cols
		y := (i / cols) % rows
		if _, err := tx.Exec(`UPDATE players SET token_x = ?, token_y = ?, token_hidden = 0 WHERE id = ?`, x, y, p.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListInventory returns all inventory items for a player.
func (s *Store) ListInventory(playerID string) ([]InventoryItem, error) {
	rows, err := s.db.Query(`
		SELECT id, player_id, name, quantity, description
		FROM inventory_items WHERE player_id = ?
		ORDER BY created_at ASC, name ASC
	`, playerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []InventoryItem
	for rows.Next() {
		var it InventoryItem
		if err := rows.Scan(&it.ID, &it.PlayerID, &it.Name, &it.Quantity, &it.Description); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	if items == nil {
		items = []InventoryItem{}
	}
	return items, rows.Err()
}

// UpsertInventoryItem creates or updates an inventory item for a player.
func (s *Store) UpsertInventoryItem(playerID, itemID, name string, quantity int, description string) (InventoryItem, error) {
	if strings.TrimSpace(name) == "" {
		return InventoryItem{}, fmt.Errorf("el nombre del objeto es obligatorio")
	}
	if quantity < 0 {
		quantity = 0
	}
	if strings.TrimSpace(itemID) == "" {
		itemID = "item_" + uuid.NewString()[:8]
		_, err := s.db.Exec(`
			INSERT INTO inventory_items (id, player_id, name, quantity, description)
			VALUES (?, ?, ?, ?, ?)
		`, itemID, playerID, strings.TrimSpace(name), quantity, strings.TrimSpace(description))
		if err != nil {
			return InventoryItem{}, err
		}
	} else {
		res, err := s.db.Exec(`
			UPDATE inventory_items SET name = ?, quantity = ?, description = ?
			WHERE id = ? AND player_id = ?
		`, strings.TrimSpace(name), quantity, strings.TrimSpace(description), itemID, playerID)
		if err != nil {
			return InventoryItem{}, err
		}
		aff, _ := res.RowsAffected()
		if aff == 0 {
			_, err = s.db.Exec(`
				INSERT INTO inventory_items (id, player_id, name, quantity, description)
				VALUES (?, ?, ?, ?, ?)
			`, itemID, playerID, strings.TrimSpace(name), quantity, strings.TrimSpace(description))
			if err != nil {
				return InventoryItem{}, err
			}
		}
	}
	return InventoryItem{
		ID:          itemID,
		PlayerID:    playerID,
		Name:        strings.TrimSpace(name),
		Quantity:    quantity,
		Description: strings.TrimSpace(description),
	}, nil
}

// AdjustInventoryQuantity increments or decrements an item's quantity, clamping at 0.
func (s *Store) AdjustInventoryQuantity(playerID, itemID string, delta int) error {
	_, err := s.db.Exec(`
		UPDATE inventory_items
		SET quantity = MAX(0, quantity + ?)
		WHERE id = ? AND player_id = ?
	`, delta, itemID, playerID)
	return err
}

// DeleteInventoryItem removes an inventory item owned by playerID.
func (s *Store) DeleteInventoryItem(playerID, itemID string) error {
	_, err := s.db.Exec(`DELETE FROM inventory_items WHERE id = ? AND player_id = ?`, itemID, playerID)
	return err
}

// GetPlayerNotes retrieves personal notes for a player.
func (s *Store) GetPlayerNotes(playerID string) (string, error) {
	var content string
	err := s.db.QueryRow(`SELECT content FROM player_notes WHERE player_id = ?`, playerID).Scan(&content)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return content, err
}

// SavePlayerNotes persists debounced notes for a player.
func (s *Store) SavePlayerNotes(playerID, content string) error {
	_, err := s.db.Exec(`
		INSERT INTO player_notes (player_id, content, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(player_id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
	`, playerID, content)
	return err
}

// GetDMNotes loads the private DM notepad content.
func (s *Store) GetDMNotes() (string, error) {
	var content string
	err := s.db.QueryRow(`SELECT content FROM dm_notes WHERE id = 1`).Scan(&content)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return content, err
}

// SaveDMNotes updates the private DM notepad content.
func (s *Store) SaveDMNotes(content string) error {
	_, err := s.db.Exec(`
		INSERT INTO dm_notes (id, content, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
	`, content)
	return err
}

// AppendActionLog writes an event or roll into the persistent audit log.
func (s *Store) AppendActionLog(playerID, playerName, actionType, details string, resultPayload any) (ActionLogEntry, error) {
	raw := json.RawMessage(`{}`)
	if resultPayload != nil {
		b, err := json.Marshal(resultPayload)
		if err == nil {
			raw = b
		}
	}
	res, err := s.db.Exec(`
		INSERT INTO action_log (session_id, player_id, player_name, action_type, details, result_json)
		VALUES (?, ?, ?, ?, ?, ?)
	`, DefaultSessionID, playerID, playerName, actionType, details, string(raw))
	if err != nil {
		return ActionLogEntry{}, err
	}
	id, _ := res.LastInsertId()
	return ActionLogEntry{
		ID:         id,
		SessionID:  DefaultSessionID,
		PlayerID:   playerID,
		PlayerName: playerName,
		ActionType: actionType,
		Details:    details,
		ResultJSON: raw,
		CreatedAt:  time.Now().UTC(),
	}, nil
}

// ListActionLog retrieves the most recent N log entries in chronological order (newest last or newest first? Let's return newest first for feed convenience).
func (s *Store) ListActionLog(limit int) ([]ActionLogEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(`
		SELECT id, session_id, player_id, player_name, action_type, details, result_json, created_at
		FROM action_log
		WHERE session_id = ?
		ORDER BY id DESC
		LIMIT ?
	`, DefaultSessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []ActionLogEntry
	for rows.Next() {
		var e ActionLogEntry
		var rawStr string
		if err := rows.Scan(&e.ID, &e.SessionID, &e.PlayerID, &e.PlayerName, &e.ActionType, &e.Details, &rawStr, &e.CreatedAt); err != nil {
			return nil, err
		}
		if rawStr == "" {
			rawStr = "{}"
		}
		e.ResultJSON = json.RawMessage(rawStr)
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []ActionLogEntry{}
	}
	return entries, rows.Err()
}

// ListMapEntities returns all DM-placed tactical map entities (enemies, traps, items, NPCs, hazards, doors).
func (s *Store) ListMapEntities() ([]MapEntity, error) {
	rows, err := s.db.Query(`
		SELECT id, session_id, kind, name, x, y, size, color_hex, hp_current, hp_max, note, is_hidden, created_at
		FROM map_entities
		WHERE session_id = ?
		ORDER BY created_at ASC, name ASC
	`, DefaultSessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entities []MapEntity
	for rows.Next() {
		var e MapEntity
		var hidden int
		if err := rows.Scan(
			&e.ID, &e.SessionID, &e.Kind, &e.Name,
			&e.X, &e.Y, &e.Size, &e.ColorHex,
			&e.HPCurrent, &e.HPMax, &e.Note, &hidden, &e.CreatedAt,
		); err != nil {
			return nil, err
		}
		e.IsHidden = hidden != 0
		entities = append(entities, e)
	}
	if entities == nil {
		entities = []MapEntity{}
	}
	return entities, rows.Err()
}

// AddMapEntity spawns a new tactical entity on the grid within valid bounds.
func (s *Store) AddMapEntity(kind, name string, x, y, size int, colorHex string, hpCurrent, hpMax int, note string, isHidden bool) (MapEntity, error) {
	sess, err := s.GetSession()
	if err != nil {
		return MapEntity{}, err
	}
	if x < 0 {
		x = 0
	} else if x >= sess.MapCols {
		x = sess.MapCols - 1
	}
	if y < 0 {
		y = 0
	} else if y >= sess.MapRows {
		y = sess.MapRows - 1
	}
	if size < 1 {
		size = 1
	} else if size > 4 {
		size = 4
	}
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind == "" {
		kind = "enemy"
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Elemento"
	}
	if strings.TrimSpace(colorHex) == "" {
		colorHex = "#ef4444"
	}
	if hpMax > 0 && hpCurrent == 0 {
		hpCurrent = hpMax
	}
	if hpMax < 0 {
		hpMax = 0
	}
	if hpCurrent < 0 {
		hpCurrent = 0
	}

	id := "ent_" + uuid.NewString()[:8]
	now := time.Now().UTC()
	hiddenInt := 0
	if isHidden {
		hiddenInt = 1
	}

	_, err = s.db.Exec(`
		INSERT INTO map_entities (id, session_id, kind, name, x, y, size, color_hex, hp_current, hp_max, note, is_hidden, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, DefaultSessionID, kind, name, x, y, size, colorHex, hpCurrent, hpMax, strings.TrimSpace(note), hiddenInt, now)
	if err != nil {
		return MapEntity{}, err
	}

	return MapEntity{
		ID:        id,
		SessionID: DefaultSessionID,
		Kind:      kind,
		Name:      name,
		X:         x,
		Y:         y,
		Size:      size,
		ColorHex:  colorHex,
		HPCurrent: hpCurrent,
		HPMax:     hpMax,
		Note:      strings.TrimSpace(note),
		IsHidden:  isHidden,
		CreatedAt: now,
	}, nil
}

// MoveMapEntity moves a DM-placed entity to (x, y) within grid bounds.
func (s *Store) MoveMapEntity(id string, x, y int) error {
	sess, err := s.GetSession()
	if err != nil {
		return err
	}
	if x < 0 || x >= sess.MapCols || y < 0 || y >= sess.MapRows {
		return fmt.Errorf("coordenadas fuera del mapa (%d, %d) para grilla %dx%d", x, y, sess.MapCols, sess.MapRows)
	}
	_, err = s.db.Exec(`UPDATE map_entities SET x = ?, y = ? WHERE id = ? AND session_id = ?`, x, y, id, DefaultSessionID)
	return err
}

// UpdateMapEntity updates mutable fields (name, HP, note, visibility) of an existing map entity.
func (s *Store) UpdateMapEntity(id, name string, hpCurrent, hpMax *int, note *string, isHidden *bool) error {
	var curName, curNote string
	var curHP, curMax, curHidden int
	err := s.db.QueryRow(`
		SELECT name, hp_current, hp_max, note, is_hidden
		FROM map_entities WHERE id = ? AND session_id = ?
	`, id, DefaultSessionID).Scan(&curName, &curHP, &curMax, &curNote, &curHidden)
	if err != nil {
		return err
	}
	if strings.TrimSpace(name) != "" {
		curName = strings.TrimSpace(name)
	}
	if hpCurrent != nil {
		curHP = *hpCurrent
		if curHP < 0 {
			curHP = 0
		}
	}
	if hpMax != nil {
		curMax = *hpMax
		if curMax < 0 {
			curMax = 0
		}
	}
	if note != nil {
		curNote = strings.TrimSpace(*note)
	}
	if isHidden != nil {
		if *isHidden {
			curHidden = 1
		} else {
			curHidden = 0
		}
	}
	_, err = s.db.Exec(`
		UPDATE map_entities
		SET name = ?, hp_current = ?, hp_max = ?, note = ?, is_hidden = ?
		WHERE id = ? AND session_id = ?
	`, curName, curHP, curMax, curNote, curHidden, id, DefaultSessionID)
	return err
}

// DeleteMapEntity removes a single entity from the tactical map.
func (s *Store) DeleteMapEntity(id string) error {
	_, err := s.db.Exec(`DELETE FROM map_entities WHERE id = ? AND session_id = ?`, id, DefaultSessionID)
	return err
}

// ClearMapEntities deletes all DM-placed entities from the active session.
func (s *Store) ClearMapEntities() error {
	_, err := s.db.Exec(`DELETE FROM map_entities WHERE session_id = ?`, DefaultSessionID)
	return err
}
