package store

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// UpdateFogState persists Fog of War enabled flag and revealed "x,y" cell keys.
func (s *Store) UpdateFogState(enabled bool, revealedCells []string) error {
	if revealedCells == nil {
		revealedCells = []string{}
	}
	raw, _ := json.Marshal(revealedCells)
	en := 0
	if enabled {
		en = 1
	}
	_, err := s.db.Exec(`
		UPDATE sessions SET fog_enabled = ?, fog_revealed_json = ? WHERE id = ?
	`, en, string(raw), DefaultSessionID)
	return err
}

// IncrementRound advances the combat round counter by 1 when wrapping to index 0.
func (s *Store) IncrementRound() error {
	_, err := s.db.Exec(`
		UPDATE sessions SET round_number = COALESCE(round_number, 1) + 1 WHERE id = ?
	`, DefaultSessionID)
	return err
}

// SetSceneCards stores pinned Fari-style index cards and progress clocks for the current scene.
func (s *Store) SetSceneCards(cards []SceneCard) error {
	if cards == nil {
		cards = []SceneCard{}
	}
	for i := range cards {
		if strings.TrimSpace(cards[i].ID) == "" {
			cards[i].ID = "card_" + uuid.NewString()[:8]
		}
		if cards[i].Kind != "clock" {
			cards[i].Kind = "aspect"
		}
		if cards[i].Segments < 2 {
			cards[i].Segments = 4
		}
		if cards[i].Filled < 0 {
			cards[i].Filled = 0
		} else if cards[i].Filled > cards[i].Segments {
			cards[i].Filled = cards[i].Segments
		}
	}
	raw, _ := json.Marshal(cards)
	_, err := s.db.Exec(`UPDATE sessions SET scene_cards_json = ? WHERE id = ?`, string(raw), DefaultSessionID)
	return err
}

// UpdatePlayerTacticalState updates player conditions, personal aura radius/color, and interactive quick sheet stats.
func (s *Store) UpdatePlayerTacticalState(playerID string, conditions []string, auraRadius *int, auraColor *string, statsJSON json.RawMessage) error {
	p, err := s.GetPlayer(playerID)
	if err != nil {
		return err
	}
	if conditions != nil {
		p.Conditions = conditions
	}
	if auraRadius != nil {
		r := *auraRadius
		if r < 0 {
			r = 0
		} else if r > 120 {
			r = 120
		}
		p.AuraRadius = r
	}
	if auraColor != nil && strings.TrimSpace(*auraColor) != "" {
		p.AuraColor = strings.TrimSpace(*auraColor)
	}
	if len(statsJSON) > 0 && string(statsJSON) != "null" {
		p.StatsJSON = statsJSON
	}
	if p.Conditions == nil {
		p.Conditions = []string{}
	}
	condRaw, _ := json.Marshal(p.Conditions)
	if len(p.StatsJSON) == 0 {
		p.StatsJSON = json.RawMessage(`{}`)
	}
	_, err = s.db.Exec(`
		UPDATE players
		SET conditions_json = ?, aura_radius = ?, aura_color = ?, stats_json = ?
		WHERE id = ?
	`, string(condRaw), p.AuraRadius, p.AuraColor, string(p.StatsJSON), playerID)
	return err
}

// UpdateMapEntityTactical updates conditions and aura on a DM map entity.
func (s *Store) UpdateMapEntityTactical(entityID string, conditions []string, auraRadius *int, auraColor *string) error {
	var curCond, curColor string
	var curRadius int
	err := s.db.QueryRow(`
		SELECT COALESCE(NULLIF(conditions_json, ''), '[]'), COALESCE(aura_radius, 0), COALESCE(aura_color, '')
		FROM map_entities WHERE id = ? AND session_id = ?
	`, entityID, DefaultSessionID).Scan(&curCond, &curRadius, &curColor)
	if err != nil {
		return err
	}
	var condList []string
	_ = json.Unmarshal([]byte(curCond), &condList)
	if conditions != nil {
		condList = conditions
	}
	if condList == nil {
		condList = []string{}
	}
	if auraRadius != nil {
		curRadius = *auraRadius
		if curRadius < 0 {
			curRadius = 0
		} else if curRadius > 120 {
			curRadius = 120
		}
	}
	if auraColor != nil {
		curColor = strings.TrimSpace(*auraColor)
	}
	condRaw, _ := json.Marshal(condList)
	_, err = s.db.Exec(`
		UPDATE map_entities SET conditions_json = ?, aura_radius = ?, aura_color = ?
		WHERE id = ? AND session_id = ?
	`, string(condRaw), curRadius, curColor, entityID, DefaultSessionID)
	return err
}

// SaveCurrentScene stores the active map layout, fog state, and entities as a switchable scene (Ogres-inspired).
func (s *Store) SaveCurrentScene(campaignID, name string) (MapScene, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return MapScene{}, fmt.Errorf("el nombre de la escena es obligatorio")
	}
	sess, err := s.GetSession()
	if err != nil {
		return MapScene{}, err
	}
	entities, _ := s.ListMapEntities()
	fogRaw, _ := json.Marshal(sess.FogRevealed)
	entRaw, _ := json.Marshal(entities)
	fogInt := 0
	if sess.FogEnabled {
		fogInt = 1
	}

	id := "scn_" + uuid.NewString()[:8]
	now := time.Now().UTC()
	_, err = s.db.Exec(`
		INSERT INTO map_scenes (
			id, campaign_id, name, map_rows, map_cols, map_image_path,
			map_grid_color, map_grid_opacity, fog_enabled, fog_revealed_json, entities_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, campaignID, name, sess.MapRows, sess.MapCols, sess.MapImagePath,
		sess.MapGridColor, sess.MapGridOpacity, fogInt, string(fogRaw), string(entRaw), now)
	if err != nil {
		return MapScene{}, err
	}
	return MapScene{
		ID:             id,
		CampaignID:     campaignID,
		Name:           name,
		MapRows:        sess.MapRows,
		MapCols:        sess.MapCols,
		MapImagePath:   sess.MapImagePath,
		MapGridColor:   sess.MapGridColor,
		MapGridOpacity: sess.MapGridOpacity,
		FogEnabled:     sess.FogEnabled,
		FogRevealed:    sess.FogRevealed,
		CreatedAt:      now,
	}, nil
}

// ListMapScenes lists all saved scenes in campaignID.
func (s *Store) ListMapScenes(campaignID string) ([]MapScene, error) {
	if strings.TrimSpace(campaignID) == "" {
		campaignID = s.GetActiveCampaignID()
	}
	rows, err := s.db.Query(`
		SELECT id, campaign_id, name, map_rows, map_cols, map_image_path, map_grid_color, map_grid_opacity, fog_enabled, fog_revealed_json, created_at
		FROM map_scenes WHERE campaign_id = ?
		ORDER BY created_at DESC
	`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MapScene
	for rows.Next() {
		var sc MapScene
		var fogInt int
		var fogStr string
		if err := rows.Scan(
			&sc.ID, &sc.CampaignID, &sc.Name, &sc.MapRows, &sc.MapCols,
			&sc.MapImagePath, &sc.MapGridColor, &sc.MapGridOpacity,
			&fogInt, &fogStr, &sc.CreatedAt,
		); err != nil {
			return nil, err
		}
		sc.FogEnabled = fogInt != 0
		_ = json.Unmarshal([]byte(fogStr), &sc.FogRevealed)
		if sc.FogRevealed == nil {
			sc.FogRevealed = []string{}
		}
		out = append(out, sc)
	}
	if out == nil {
		out = []MapScene{}
	}
	return out, rows.Err()
}

// ActivateMapScene swaps the live tabletop map, fog, and entities to a previously saved scene.
func (s *Store) ActivateMapScene(sceneID string) error {
	var sc MapScene
	var fogInt int
	var fogStr, entStr string
	err := s.db.QueryRow(`
		SELECT id, campaign_id, name, map_rows, map_cols, map_image_path, map_grid_color, map_grid_opacity, fog_enabled, fog_revealed_json, entities_json
		FROM map_scenes WHERE id = ?
	`, sceneID).Scan(
		&sc.ID, &sc.CampaignID, &sc.Name, &sc.MapRows, &sc.MapCols,
		&sc.MapImagePath, &sc.MapGridColor, &sc.MapGridOpacity,
		&fogInt, &fogStr, &entStr,
	)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		UPDATE sessions
		SET map_enabled = 1, map_rows = ?, map_cols = ?, map_image_path = ?, map_grid_color = ?, map_grid_opacity = ?,
		    fog_enabled = ?, fog_revealed_json = ?
		WHERE id = ?
	`, sc.MapRows, sc.MapCols, sc.MapImagePath, sc.MapGridColor, sc.MapGridOpacity, fogInt, fogStr, DefaultSessionID); err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM map_entities WHERE session_id = ?`, DefaultSessionID); err != nil {
		return err
	}
	var entities []MapEntity
	_ = json.Unmarshal([]byte(entStr), &entities)
	for _, ent := range entities {
		hid := 0
		if ent.IsHidden {
			hid = 1
		}
		condRaw, _ := json.Marshal(ent.Conditions)
		if _, err := tx.Exec(`
			INSERT INTO map_entities (id, session_id, kind, name, x, y, size, color_hex, hp_current, hp_max, note, is_hidden, conditions_json, aura_radius, aura_color, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, ent.ID, DefaultSessionID, ent.Kind, ent.Name, ent.X, ent.Y, ent.Size, ent.ColorHex, ent.HPCurrent, ent.HPMax, ent.Note, hid, string(condRaw), ent.AuraRadius, ent.AuraColor, ent.CreatedAt); err != nil {
			return err
		}
	}

	// Keep player tokens inside new scene grid dimensions
	_, _ = tx.Exec(`
		UPDATE players
		SET token_x = CASE WHEN token_x >= ? THEN ? ELSE token_x END,
		    token_y = CASE WHEN token_y >= ? THEN ? ELSE token_y END
		WHERE session_id = ?
	`, sc.MapCols, sc.MapCols-1, sc.MapRows, sc.MapRows-1, DefaultSessionID)

	return tx.Commit()
}

// DeleteMapScene deletes a saved scene preset.
func (s *Store) DeleteMapScene(sceneID string) error {
	_, err := s.db.Exec(`DELETE FROM map_scenes WHERE id = ?`, sceneID)
	return err
}
