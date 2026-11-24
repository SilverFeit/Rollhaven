package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// User represents a persistent Rollhaven player account identified by username.
type User struct {
	ID                string    `json:"id"`
	Username          string    `json:"username"`
	DisplayName       string    `json:"display_name"`
	ActiveCharacterID string    `json:"active_character_id"`
	CreatedAt         time.Time `json:"created_at"`
	LastLoginAt       time.Time `json:"last_login_at"`
}

// Character represents a persistent D&D character sheet tied to a campaign and optionally assigned to a user.
type Character struct {
	ID             string          `json:"id"`
	CampaignID     string          `json:"campaign_id"`
	UserID         string          `json:"user_id"`
	Name           string          `json:"name"`
	AvatarURL      string          `json:"avatar_url"`
	Level          int             `json:"level"`
	SpeciesSlug    string          `json:"species_slug"`
	SpeciesName    string          `json:"species_name"`
	ClassSlug      string          `json:"class_slug"`
	ClassName      string          `json:"class_name"`
	SubclassName   string          `json:"subclass_name"`
	BackgroundSlug string          `json:"background_slug"`
	BackgroundName string          `json:"background_name"`
	SheetJSON      json.RawMessage `json:"sheet_json"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// ListUsers returns all registered users ordered by most recent login.
func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`
		SELECT id, username, display_name, COALESCE(active_character_id, ''), created_at, last_login_at
		FROM users
		ORDER BY last_login_at DESC, username ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.ActiveCharacterID, &u.CreatedAt, &u.LastLoginAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	if out == nil {
		out = []User{}
	}
	return out, rows.Err()
}

// GetUser fetches a single persistent user by ID.
func (s *Store) GetUser(id string) (User, error) {
	var u User
	err := s.db.QueryRow(`
		SELECT id, username, display_name, COALESCE(active_character_id, ''), created_at, last_login_at
		FROM users WHERE id = ?
	`, id).Scan(&u.ID, &u.Username, &u.DisplayName, &u.ActiveCharacterID, &u.CreatedAt, &u.LastLoginAt)
	return u, err
}

// LoginUser logs into an existing user (by userID or case-insensitive username) or registers a new username.
func (s *Store) LoginUser(username, userID string) (User, error) {
	cleanID := strings.TrimSpace(userID)
	cleanName := strings.TrimSpace(username)

	if cleanID != "" {
		u, err := s.GetUser(cleanID)
		if err == nil {
			_, _ = s.db.Exec(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, u.ID)
			return s.GetUser(u.ID)
		}
	}

	if cleanName == "" {
		return User{}, fmt.Errorf("el username es obligatorio")
	}

	var existingID string
	err := s.db.QueryRow(`SELECT id FROM users WHERE LOWER(username) = LOWER(?)`, cleanName).Scan(&existingID)
	if err == nil && existingID != "" {
		_, _ = s.db.Exec(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, existingID)
		return s.GetUser(existingID)
	}
	if err != nil && err != sql.ErrNoRows {
		return User{}, err
	}

	newID := "u_" + uuid.NewString()[:8]
	now := time.Now().UTC()
	_, err = s.db.Exec(`
		INSERT INTO users (id, username, display_name, active_character_id, created_at, last_login_at)
		VALUES (?, ?, ?, '', ?, ?)
	`, newID, cleanName, cleanName, now, now)
	if err != nil {
		return User{}, err
	}
	return s.GetUser(newID)
}

// ListCharacters returns all persistent characters for the given campaign (or all if empty).
func (s *Store) ListCharacters(campaignID string) ([]Character, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	rows, err := s.db.Query(`
		SELECT id, campaign_id, COALESCE(user_id, ''), name, COALESCE(avatar_url, ''),
		       COALESCE(level, 1), COALESCE(species_slug, ''), COALESCE(species_name, ''),
		       COALESCE(class_slug, ''), COALESCE(class_name, ''), COALESCE(subclass_name, ''),
		       COALESCE(background_slug, ''), COALESCE(background_name, ''),
		       COALESCE(NULLIF(sheet_json, ''), '{}'), created_at, updated_at
		FROM characters
		WHERE campaign_id = ?
		ORDER BY updated_at DESC, name ASC
	`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Character
	for rows.Next() {
		var c Character
		var rawSheet string
		if err := rows.Scan(
			&c.ID, &c.CampaignID, &c.UserID, &c.Name, &c.AvatarURL,
			&c.Level, &c.SpeciesSlug, &c.SpeciesName,
			&c.ClassSlug, &c.ClassName, &c.SubclassName,
			&c.BackgroundSlug, &c.BackgroundName,
			&rawSheet, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		c.SheetJSON = json.RawMessage(rawSheet)
		out = append(out, c)
	}
	if out == nil {
		out = []Character{}
	}
	return out, rows.Err()
}

// GetCharacter retrieves a single persistent character sheet by ID.
func (s *Store) GetCharacter(id string) (Character, error) {
	var c Character
	var rawSheet string
	err := s.db.QueryRow(`
		SELECT id, campaign_id, COALESCE(user_id, ''), name, COALESCE(avatar_url, ''),
		       COALESCE(level, 1), COALESCE(species_slug, ''), COALESCE(species_name, ''),
		       COALESCE(class_slug, ''), COALESCE(class_name, ''), COALESCE(subclass_name, ''),
		       COALESCE(background_slug, ''), COALESCE(background_name, ''),
		       COALESCE(NULLIF(sheet_json, ''), '{}'), created_at, updated_at
		FROM characters WHERE id = ?
	`, id).Scan(
		&c.ID, &c.CampaignID, &c.UserID, &c.Name, &c.AvatarURL,
		&c.Level, &c.SpeciesSlug, &c.SpeciesName,
		&c.ClassSlug, &c.ClassName, &c.SubclassName,
		&c.BackgroundSlug, &c.BackgroundName,
		&rawSheet, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return Character{}, err
	}
	c.SheetJSON = json.RawMessage(rawSheet)
	return c, nil
}

// UpsertCharacter creates or updates a persistent character sheet.
func (s *Store) UpsertCharacter(c Character) (Character, error) {
	if strings.TrimSpace(c.Name) == "" {
		return Character{}, fmt.Errorf("el nombre del personaje es obligatorio")
	}
	if strings.TrimSpace(c.CampaignID) == "" {
		c.CampaignID = s.GetActiveCampaignID()
	}
	if c.Level < 1 {
		c.Level = 1
	} else if c.Level > 20 {
		c.Level = 20
	}
	if len(c.SheetJSON) == 0 {
		c.SheetJSON = json.RawMessage(`{}`)
	}
	if strings.TrimSpace(c.ID) == "" {
		c.ID = "char_" + uuid.NewString()[:8]
	}

	now := time.Now().UTC()
	_, err := s.db.Exec(`
		INSERT INTO characters (
			id, campaign_id, user_id, name, avatar_url, level,
			species_slug, species_name, class_slug, class_name, subclass_name,
			background_slug, background_name, sheet_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			user_id = CASE WHEN excluded.user_id != '' THEN excluded.user_id ELSE characters.user_id END,
			name = excluded.name,
			avatar_url = excluded.avatar_url,
			level = excluded.level,
			species_slug = excluded.species_slug,
			species_name = excluded.species_name,
			class_slug = excluded.class_slug,
			class_name = excluded.class_name,
			subclass_name = excluded.subclass_name,
			background_slug = excluded.background_slug,
			background_name = excluded.background_name,
			sheet_json = excluded.sheet_json,
			updated_at = excluded.updated_at
	`, c.ID, c.CampaignID, c.UserID, strings.TrimSpace(c.Name), c.AvatarURL, c.Level,
		c.SpeciesSlug, c.SpeciesName, c.ClassSlug, c.ClassName, c.SubclassName,
		c.BackgroundSlug, c.BackgroundName, string(c.SheetJSON), now, now,
	)
	if err != nil {
		return Character{}, err
	}

	// If bound to a user who doesn't yet have an active character (or update matching player), link them.
	if c.UserID != "" {
		var curActive string
		_ = s.db.QueryRow(`SELECT COALESCE(active_character_id, '') FROM users WHERE id = ?`, c.UserID).Scan(&curActive)
		if curActive == "" || curActive == c.ID {
			_ = s.AssignCharacter(c.UserID, "", c.ID)
		}
	}
	return s.GetCharacter(c.ID)
}

// DeleteCharacter removes a character sheet and clears references on users/players.
func (s *Store) DeleteCharacter(id string) error {
	_, _ = s.db.Exec(`UPDATE users SET active_character_id = '' WHERE active_character_id = ?`, id)
	_, _ = s.db.Exec(`UPDATE players SET character_id = '' WHERE character_id = ?`, id)
	_, err := s.db.Exec(`DELETE FROM characters WHERE id = ?`, id)
	return err
}

// AssignCharacter links a Character to a persistent User and/or active session Player, syncing display/avatar/stats.
func (s *Store) AssignCharacter(userID, playerID, characterID string) error {
	var charObj Character
	hasChar := strings.TrimSpace(characterID) != ""
	if hasChar {
		var err error
		charObj, err = s.GetCharacter(characterID)
		if err != nil {
			return err
		}
		if userID != "" {
			_, _ = s.db.Exec(`UPDATE characters SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, userID, characterID)
		}
	}

	if userID != "" {
		_, _ = s.db.Exec(`UPDATE users SET active_character_id = ? WHERE id = ?`, characterID, userID)
	}

	// Sync matching session player(s)
	syncPlayer := func(pid string) {
		if hasChar {
			_, _ = s.db.Exec(`
				UPDATE players
				SET character_id = ?, name = ?, avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END,
				    stats_json = ?, last_seen = CURRENT_TIMESTAMP
				WHERE id = ?
			`, charObj.ID, charObj.Name, charObj.AvatarURL, charObj.AvatarURL, string(charObj.SheetJSON), pid)
		} else {
			_, _ = s.db.Exec(`UPDATE players SET character_id = '' WHERE id = ?`, pid)
		}
	}

	if playerID != "" {
		syncPlayer(playerID)
	} else if userID != "" {
		rows, err := s.db.Query(`SELECT id FROM players WHERE user_id = ? AND session_id = ?`, userID, DefaultSessionID)
		if err == nil {
			var pids []string
			for rows.Next() {
				var pid string
				if err := rows.Scan(&pid); err == nil {
					pids = append(pids, pid)
				}
			}
			rows.Close()
			for _, pid := range pids {
				syncPlayer(pid)
			}
		}
	}
	return nil
}

// UpsertPlayerForUser registers or rehydrates a session Player tied to a persistent User.
func (s *Store) UpsertPlayerForUser(userID, username, playerID string, initiative int, raceIcon, colorHex, clientIP, userAgent string) (Player, User, error) {
	u, err := s.LoginUser(username, userID)
	if err != nil {
		return Player{}, User{}, err
	}

	// Check if this user already has a player token in the active session
	cleanPID := strings.TrimSpace(playerID)
	if cleanPID == "" {
		var existingPID string
		err := s.db.QueryRow(`SELECT id FROM players WHERE user_id = ? AND session_id = ? LIMIT 1`, u.ID, DefaultSessionID).Scan(&existingPID)
		if err == nil && existingPID != "" {
			cleanPID = existingPID
		}
	}

	displayName := u.DisplayName
	avatarURL := ""
	charID := u.ActiveCharacterID
	sheetJSON := "{}"
	if charID != "" {
		if ch, cErr := s.GetCharacter(charID); cErr == nil {
			displayName = ch.Name
			avatarURL = ch.AvatarURL
			if len(ch.SheetJSON) > 0 {
				sheetJSON = string(ch.SheetJSON)
			}
		} else {
			charID = ""
		}
	}

	p, err := s.UpsertPlayer(cleanPID, displayName, initiative, raceIcon, colorHex, clientIP, userAgent)
	if err != nil {
		return Player{}, u, err
	}

	_, _ = s.db.Exec(`
		UPDATE players
		SET user_id = ?, character_id = ?, avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END,
		    stats_json = CASE WHEN ? != '{}' THEN ? ELSE stats_json END
		WHERE id = ?
	`, u.ID, charID, avatarURL, avatarURL, sheetJSON, sheetJSON, p.ID)

	p, err = s.GetPlayer(p.ID)
	return p, u, err
}
