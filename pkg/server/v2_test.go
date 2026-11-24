package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/SilverFeit/Rollhaven/pkg/compendium"
	"github.com/SilverFeit/Rollhaven/pkg/server"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestCompendiumRESTAndGraphLinks(t *testing.T) {
	srv, ts := setupTestServer(t)
	comp, err := compendium.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open memory compendium: %v", err)
	}
	defer comp.Close()
	srv.Compendium = comp

	resp, err := http.Get(ts.URL + "/api/v1/compendium/status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for compendium status, got %d", resp.StatusCode)
	}
	var status compendium.CompendiumStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	if !status.Connected || status.Driver != "sqlite" || status.Counts["species"] == 0 {
		t.Fatalf("unexpected compendium status: %+v", status)
	}

	bgResp, err := http.Get(ts.URL + "/api/v1/compendium/backgrounds/demo-centinela-frontera")
	if err != nil {
		t.Fatal(err)
	}
	defer bgResp.Body.Close()
	if bgResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for background detail, got %d", bgResp.StatusCode)
	}
	var env compendium.EntryEnvelope
	if err := json.NewDecoder(bgResp.Body).Decode(&env); err != nil {
		t.Fatal(err)
	}
	if len(env.Links) == 0 {
		t.Fatalf("expected linked origin feat ref on 2024 background, got %+v", env)
	}
}

func TestPersistentUserLoginAndCharacterAssignment(t *testing.T) {
	_, ts := setupTestServer(t)

	// 1. Login with username only
	loginResp, err := http.Post(ts.URL+"/api/v1/users/login", "application/json", strings.NewReader(`{"username":"rembrandt"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 login, got %d", loginResp.StatusCode)
	}
	var loginData struct {
		User struct {
			ID       string `json:"id"`
			Username string `json:"username"`
		} `json:"user"`
	}
	if err := json.NewDecoder(loginResp.Body).Decode(&loginData); err != nil {
		t.Fatal(err)
	}
	if loginData.User.ID == "" || loginData.User.Username != "rembrandt" {
		t.Fatalf("unexpected login user: %+v", loginData.User)
	}

	// 2. Create character sheet
	charBody := `{"name":"Lyra Demo","level":3,"species_slug":"demo-caminante-solar","species_name":"Caminante Solar","class_slug":"demo-arcanista","class_name":"Arcanista","sheet_json":{"name":"Lyra Demo","level":3,"hp_current":18,"hp_max":18}}`
	charResp, err := http.Post(ts.URL+"/api/v1/characters", "application/json", bytes.NewBufferString(charBody))
	if err != nil {
		t.Fatal(err)
	}
	defer charResp.Body.Close()
	if charResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 creating character, got %d", charResp.StatusCode)
	}
	var charData struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(charResp.Body).Decode(&charData); err != nil {
		t.Fatal(err)
	}

	// 3. Assign character as DM
	assignReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/dm/assign-character", strings.NewReader(
		`{"user_id":"`+loginData.User.ID+`","character_id":"`+charData.ID+`"}`,
	))
	assignReq.Header.Set("Content-Type", "application/json")
	assignReq.Header.Set("X-DM-PIN", "8492")
	assignResp, err := http.DefaultClient.Do(assignReq)
	if err != nil {
		t.Fatal(err)
	}
	assignResp.Body.Close()
	if assignResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 assign-character, got %d", assignResp.StatusCode)
	}

	// 4. WebSocket JOIN_ROOM with username only rehydrates assigned character
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, conn, "STATE_SYNC")

	if err := wsjson.Write(ctx, conn, server.WSMessage{
		Event:   "JOIN_ROOM",
		Payload: json.RawMessage(`{"user_id":"` + loginData.User.ID + `","username":"rembrandt"}`),
	}); err != nil {
		t.Fatal(err)
	}
	ack := readUntilEvent(t, ctx, conn, "JOIN_ACK")
	if !strings.Contains(string(ack.Payload), "Lyra Demo") {
		t.Fatalf("expected JOIN_ACK to hydrate assigned character Lyra Demo, got %s", string(ack.Payload))
	}
}

func TestInteractiveRollCardsAutoInitiativeAndUnifiedCombatants(t *testing.T) {
	_, ts := setupTestServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	dmConn, _, err := websocket.Dial(ctx, wsURL+"?role=dm&pin=8492", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer dmConn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, dmConn, "STATE_SYNC")

	pConn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer pConn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, pConn, "STATE_SYNC")

	_ = wsjson.Write(ctx, pConn, server.WSMessage{
		Event:   "JOIN_ROOM",
		Payload: json.RawMessage(`{"username":"thorin"}`),
	})
	_ = readUntilEvent(t, ctx, pConn, "JOIN_ACK")
	_ = readUntilEvent(t, ctx, pConn, "STATE_SYNC")

	// 1. Trigger ABILITY_CARD (Fireball with interactive save & damage actions)
	_ = wsjson.Write(ctx, pConn, server.WSMessage{
		Event: "ROLL_ACTION",
		Payload: json.RawMessage(`{
			"type":"ABILITY_CARD",
			"source":{"kind":"spell","name":"Fireball","subtitle":"CD 15"},
			"interactive_actions":[
				{"id":"s1","kind":"SAVE","label":"Lanzar Salvación DES (CD 15)","ability":"DES","dc":15},
				{"id":"d1","kind":"DAMAGE","label":"Rolear Daño (8d6)","formula":"8d6","damage_type":"Fuego"}
			]
		}`),
	})
	cardMsg := readUntilEvent(t, ctx, pConn, "RESULT_BROADCAST")
	var rb server.RollBroadcast
	if err := json.Unmarshal(cardMsg.Payload, &rb); err != nil {
		t.Fatal(err)
	}
	if rb.Source == nil || rb.Source.Name != "Fireball" || len(rb.InteractiveActions) != 2 {
		t.Fatalf("unexpected interactive ability card broadcast: %+v", rb)
	}

	// 2. Roll saving throw with target_dc -> evaluates SUCCESS or FAILURE
	_ = wsjson.Write(ctx, pConn, server.WSMessage{
		Event: "ROLL_ACTION",
		Payload: json.RawMessage(`{
			"type":"DICE",
			"dice_notation":"1d20+2",
			"target_dc":15,
			"source":{"kind":"save","name":"Salvación DES","subtitle":"vs Fireball"}
		}`),
	})
	saveMsg := readUntilEvent(t, ctx, pConn, "RESULT_BROADCAST")
	var saveRB server.RollBroadcast
	if err := json.Unmarshal(saveMsg.Payload, &saveRB); err != nil {
		t.Fatal(err)
	}
	if saveRB.SaveOutcome != "SUCCESS" && saveRB.SaveOutcome != "FAILURE" {
		t.Fatalf("expected save_outcome SUCCESS or FAILURE, got %q", saveRB.SaveOutcome)
	}

	// 3. Roll initiative with update_initiative=true + add monster into unified Combatants
	_ = wsjson.Write(ctx, pConn, server.WSMessage{
		Event: "ROLL_ACTION",
		Payload: json.RawMessage(`{
			"type":"DICE",
			"dice_notation":"1d20+3",
			"update_initiative":true,
			"source":{"kind":"initiative","name":"Iniciativa"}
		}`),
	})
	_ = readUntilEvent(t, ctx, pConn, "RESULT_BROADCAST")

	_ = wsjson.Write(ctx, dmConn, server.WSMessage{
		Event: "DM_OVERRIDE",
		Payload: json.RawMessage(`{
			"action":"ADD_MAP_ENTITY",
			"pin":"8492",
			"entity_kind":"enemy",
			"entity_name":"Draco Demo",
			"entity_size":2,
			"entity_color":"#dc2626",
			"entity_hp_current":50,
			"entity_hp_max":50,
			"entity_in_initiative":true,
			"entity_initiative":99,
			"target_x":1,
			"target_y":1
		}`),
	})

	// Wait until STATE_SYNC reflects Draco Demo at top of unified Combatants
	var snap server.StateSnapshot
	for {
		syncMsg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		if err := json.Unmarshal(syncMsg.Payload, &snap); err != nil {
			t.Fatal(err)
		}
		if len(snap.Combatants) >= 2 && snap.Combatants[0].Kind == "monster" && snap.Combatants[0].Name == "Draco Demo" {
			break
		}
	}
	if snap.ActiveCombatantID == "" {
		t.Fatalf("expected active_combatant_id populated in unified combatants")
	}
}
