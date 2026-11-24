package server_test

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/SilverFeit/Rollhaven/pkg/database"
	"github.com/SilverFeit/Rollhaven/pkg/server"
	"github.com/SilverFeit/Rollhaven/pkg/store"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func setupTestServer(t *testing.T) (*server.Server, *httptest.Server) {
	t.Helper()
	db, err := database.Open(":memory:")
	if err != nil {
		t.Fatalf("open memory sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	st, err := store.New(db)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	dataDir := t.TempDir()
	srv, err := server.New(st, dataDir, "192.168.1.42", 8080, "8492")
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	ts := httptest.NewServer(srv.Router)
	t.Cleanup(func() {
		srv.Hub.Close()
		ts.Close()
	})
	return srv, ts
}

func readUntilEvent(t *testing.T, ctx context.Context, conn *websocket.Conn, targetEvent string) server.WSMessage {
	t.Helper()
	for {
		var msg server.WSMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			t.Fatalf("ws read waiting for %s: %v", targetEvent, err)
		}
		if msg.Event == targetEvent {
			return msg
		}
	}
}

func TestHealthAndDMAuth(t *testing.T) {
	_, ts := setupTestServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var health map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if health["lan_ip"] != "192.168.1.42" || health["app"] != "Rollhaven" || health["version"] != "1.5.0" || health["license"] != "MIT" {
		t.Fatalf("unexpected health response: %+v", health)
	}

	// Test wrong PIN vs right PIN
	badResp, err := http.Post(ts.URL+"/api/v1/dm/auth", "application/json", strings.NewReader(`{"pin":"0000"}`))
	if err != nil {
		t.Fatal(err)
	}
	badResp.Body.Close()
	if badResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong PIN, got %d", badResp.StatusCode)
	}

	goodResp, err := http.Post(ts.URL+"/api/v1/dm/auth", "application/json", strings.NewReader(`{"pin":"8492"}`))
	if err != nil {
		t.Fatal(err)
	}
	goodResp.Body.Close()
	if goodResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for valid PIN, got %d", goodResp.StatusCode)
	}
}

func TestWebSocketEightPlayersTurnFlowAndReconnection(t *testing.T) {
	_, ts := setupTestServer(t)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Connect DM client
	dmConn, _, err := websocket.Dial(ctx, wsURL+"?role=dm&pin=8492", nil)
	if err != nil {
		t.Fatalf("dial DM ws: %v", err)
	}
	defer dmConn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, dmConn, "STATE_SYNC")

	// Connect 8 players (SDD-07 acceptance test requirement: >= 8 concurrent clients)
	conns := make([]*websocket.Conn, 8)
	playerIDs := make([]string, 8)
	initiatives := []int{12, 20, 8, 18, 15, 20, 5, 11}
	for i := 0; i < 8; i++ {
		c, _, err := websocket.Dial(ctx, wsURL, nil)
		if err != nil {
			t.Fatalf("dial player %d: %v", i, err)
		}
		conns[i] = c
		_ = readUntilEvent(t, ctx, c, "STATE_SYNC")

		joinPayload, _ := json.Marshal(map[string]any{
			"name":       fmt.Sprintf("Hero-%d", i+1),
			"initiative": initiatives[i],
			"race":       "elf",
			"color":      "#a855f7",
		})
		if err := wsjson.Write(ctx, c, server.WSMessage{Event: "JOIN_ROOM", Payload: joinPayload}); err != nil {
			t.Fatal(err)
		}
		ack := readUntilEvent(t, ctx, c, "JOIN_ACK")
		playerIDs[i] = ack.PlayerID
	}
	defer func() {
		for _, c := range conns {
			if c != nil {
				_ = c.Close(websocket.StatusNormalClosure, "done")
			}
		}
	}()

	// Player index 1 (Hero-2, initiative 20, joined before Hero-6 who also has 20) should be first!
	var snap server.StateSnapshot
	syncMsg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
	for len(snap.Players) < 8 {
		if err := json.Unmarshal(syncMsg.Payload, &snap); err != nil {
			t.Fatal(err)
		}
		if len(snap.Players) < 8 {
			syncMsg = readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		}
	}
	if snap.ActivePlayerID != playerIDs[1] {
		t.Fatalf("expected Hero-2 (%s) first in initiative tie-break, got %s", playerIDs[1], snap.ActivePlayerID)
	}

	// Active player Hero-2 executes multiple rolls in the same turn (Dice + Coin + Magic 8 Ball + Spinner + Wheel)
	rollSpecs := []map[string]any{
		{"type": "DICE", "dice_notation": "1d20+3"},
		{"type": "COIN"},
		{"type": "MAGIC_8_BALL", "strict_yes_no": false, "question": "¿Hay trampa?"},
		{"type": "SPINNER", "faces": []string{"A", "B", "C", "D"}},
		{"type": "WHEEL", "options": []string{"Atacar", "Huir"}},
	}
	for _, rs := range rollSpecs {
		b, _ := json.Marshal(rs)
		if err := wsjson.Write(ctx, conns[1], server.WSMessage{Event: "ROLL_ACTION", Payload: b}); err != nil {
			t.Fatal(err)
		}
		_ = readUntilEvent(t, ctx, conns[0], "RESULT_BROADCAST")
	}

	// Non-active player trying END_TURN must receive ERROR and not advance turn
	if err := wsjson.Write(ctx, conns[0], server.WSMessage{Event: "END_TURN", Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	errMsg := readUntilEvent(t, ctx, conns[0], "ERROR")
	if !strings.Contains(string(errMsg.Payload), "turno") {
		t.Fatalf("unexpected error payload: %s", string(errMsg.Payload))
	}

	// Active player ends turn -> should move to Hero-6 (second 20 initiative)
	if err := wsjson.Write(ctx, conns[1], server.WSMessage{Event: "END_TURN", Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := readUntilEvent(t, ctx, conns[5], "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if snap.ActivePlayerID == playerIDs[5] {
			break
		}
	}

	// Disconnect Hero-6 and reconnect with session_token (player_id) -> preserves turn and profile!
	_ = conns[5].Close(websocket.StatusNormalClosure, "screen lock")
	conns[5] = nil
	time.Sleep(50 * time.Millisecond)

	reconn, _, err := websocket.Dial(ctx, wsURL+"?player_id="+playerIDs[5], nil)
	if err != nil {
		t.Fatalf("reconnect Hero-6: %v", err)
	}
	conns[5] = reconn
	reSync := readUntilEvent(t, ctx, reconn, "STATE_SYNC")
	_ = json.Unmarshal(reSync.Payload, &snap)
	if snap.ActivePlayerID != playerIDs[5] || len(snap.Players) != 8 {
		t.Fatalf("rehydration failed: active=%s want=%s count=%d", snap.ActivePlayerID, playerIDs[5], len(snap.Players))
	}

	// DM configures 50x50 tactical map and enables it
	mapCfg, _ := json.Marshal(map[string]any{
		"action":      "UPDATE_MAP_CONFIG",
		"map_enabled": true,
		"map_rows":    50,
		"map_cols":    50,
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: mapCfg}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := readUntilEvent(t, ctx, conns[5], "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if snap.Session.MapEnabled && snap.Session.MapRows == 50 && snap.Session.MapCols == 50 {
			break
		}
	}

	// Player attempts to move someone else's token -> blocked!
	illegalMove, _ := json.Marshal(map[string]any{
		"player_id": playerIDs[0],
		"target_x":  10,
		"target_y":  10,
	})
	if err := wsjson.Write(ctx, conns[5], server.WSMessage{Event: "MOVE_TOKEN", Payload: illegalMove}); err != nil {
		t.Fatal(err)
	}
	_ = readUntilEvent(t, ctx, conns[5], "ERROR")

	// Player moves their own token to (49, 49) on 50x50 grid -> succeeds!
	validMove, _ := json.Marshal(map[string]any{
		"target_x": 49,
		"target_y": 49,
	})
	if err := wsjson.Write(ctx, conns[5], server.WSMessage{Event: "MOVE_TOKEN", Payload: validMove}); err != nil {
		t.Fatal(err)
	}
	movedMsg := readUntilEvent(t, ctx, dmConn, "TOKEN_MOVED")
	if !strings.Contains(string(movedMsg.Payload), `"x":49`) {
		t.Fatalf("unexpected TOKEN_MOVED: %s", string(movedMsg.Payload))
	}
}

func TestUploadsAndPersistenceREST(t *testing.T) {
	srv, ts := setupTestServer(t)
	player, err := srv.Store.UpsertPlayer("", "Aragorn", 16, "human", "#22c55e", "127.0.0.1", "TestUA")
	if err != nil {
		t.Fatal(err)
	}

	// Upload character sheet PDF
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("player_id", player.ID)
	fw, err := mw.CreateFormFile("file", "aragorn_sheet.pdf")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write([]byte("%PDF-1.4\n%fake-sheet\n"))
	_ = mw.Close()

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/upload/sheet", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on sheet upload, got %d", resp.StatusCode)
	}
	var upResp map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&upResp); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(upResp["file_path"], "/uploads/sheets/") {
		t.Fatalf("unexpected file_path: %+v", upResp)
	}

	// Verify uploaded file can be served back
	getResp, err := http.Get(ts.URL + upResp["file_path"])
	if err != nil {
		t.Fatal(err)
	}
	getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 serving uploaded file, got %d", getResp.StatusCode)
	}
}

func TestDualProtocolHTTPAndHTTPS(t *testing.T) {
	db, err := database.Open(":memory:")
	if err != nil {
		t.Fatalf("open memory sqlite: %v", err)
	}
	defer db.Close()

	st, err := store.New(db)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	srv, err := server.New(st, t.TempDir(), "127.0.0.1", 0, "1234")
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	defer srv.Hub.Close()

	rawLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	dualLn := server.NewDualProtocolListener(rawLn, srv.TLSConfig)
	httpSrv := &http.Server{Handler: srv.Router}
	go func() { _ = httpSrv.Serve(dualLn) }()
	defer httpSrv.Close()

	addr := rawLn.Addr().String()

	// 1. Plain HTTP check
	rHTTP, err := http.Get("http://" + addr + "/api/v1/health")
	if err != nil {
		t.Fatalf("HTTP GET failed: %v", err)
	}
	rHTTP.Body.Close()
	if rHTTP.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on HTTP, got %d", rHTTP.StatusCode)
	}

	// 2. HTTPS check on the SAME port
	httpsClient := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
	rHTTPS, err := httpsClient.Get("https://" + addr + "/api/v1/tls/ca.crt")
	if err != nil {
		t.Fatalf("HTTPS GET failed: %v", err)
	}
	rHTTPS.Body.Close()
	if rHTTPS.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on HTTPS CA cert, got %d", rHTTPS.StatusCode)
	}

	// 3. WSS WebSocket upgrade over TLS on the SAME port
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wsConn, _, err := websocket.Dial(ctx, "wss://"+addr+"/ws", &websocket.DialOptions{
		HTTPClient: httpsClient,
	})
	if err != nil {
		t.Fatalf("WSS dial failed: %v", err)
	}
	_ = readUntilEvent(t, ctx, wsConn, "STATE_SYNC")
	_ = wsConn.Close(websocket.StatusNormalClosure, "ok")
}

func TestDMAllFiveDecisionSetsAndMapEntities(t *testing.T) {
	_, ts := setupTestServer(t)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Connect DM with explicit role & PIN
	dmConn, _, err := websocket.Dial(ctx, wsURL+"?role=dm&pin=8492", nil)
	if err != nil {
		t.Fatalf("dial dm ws: %v", err)
	}
	defer dmConn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, dmConn, "STATE_SYNC")

	// Connect a player so broadcasts have an observer
	playerConn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial player ws: %v", err)
	}
	defer playerConn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, playerConn, "STATE_SYNC")

	joinPayload, _ := json.Marshal(map[string]any{
		"name":       "Lyra",
		"initiative": 17,
		"race":       "elf",
		"color":      "#38bdf8",
	})
	if err := wsjson.Write(ctx, playerConn, server.WSMessage{Event: "JOIN_ROOM", Payload: joinPayload}); err != nil {
		t.Fatal(err)
	}
	_ = readUntilEvent(t, ctx, playerConn, "JOIN_ACK")

	// 1. DM launches all 5 decision sets independently of whose turn it is
	dmRolls := []map[string]any{
		{"type": "DICE", "dice_notation": "1d20", "as_dm": true},
		{"type": "COIN", "as_dm": true},
		{"type": "MAGIC_8_BALL", "strict_yes_no": false, "question": "¿Hay trampa?", "as_dm": true},
		{"type": "SPINNER", "faces": []string{"N", "S", "E", "O"}, "as_dm": true},
		{"type": "WHEEL", "options": []string{"Cofre", "Emboscada"}, "as_dm": true},
	}
	for _, roll := range dmRolls {
		b, _ := json.Marshal(roll)
		if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "ROLL_ACTION", Payload: b}); err != nil {
			t.Fatal(err)
		}
		resMsg := readUntilEvent(t, ctx, playerConn, "RESULT_BROADCAST")
		if resMsg.Event != "RESULT_BROADCAST" {
			t.Fatalf("expected RESULT_BROADCAST for %v", roll["type"])
		}
	}

	// 2. Non-?role=dm connection can also elevate cleanly using valid PIN on ROLL_ACTION
	dmLateConn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial late dm ws: %v", err)
	}
	defer dmLateConn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, dmLateConn, "STATE_SYNC")

	elevatedRoll, _ := json.Marshal(map[string]any{
		"type":  "WHEEL",
		"as_dm": true,
		"pin":   "8492",
	})
	if err := wsjson.Write(ctx, dmLateConn, server.WSMessage{Event: "ROLL_ACTION", Payload: elevatedRoll}); err != nil {
		t.Fatal(err)
	}
	_ = readUntilEvent(t, ctx, playerConn, "RESULT_BROADCAST")

	// 3. Configure rectangular map 20x30 (horizontal/corridor) and verify entity clamping & CRUD
	rectCfg, _ := json.Marshal(map[string]any{
		"action":      "UPDATE_MAP_CONFIG",
		"map_enabled": true,
		"map_rows":    20,
		"map_cols":    30,
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: rectCfg}); err != nil {
		t.Fatal(err)
	}

	var snap server.StateSnapshot
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		if err := json.Unmarshal(msg.Payload, &snap); err != nil {
			t.Fatal(err)
		}
		if snap.Session.MapEnabled && snap.Session.MapRows == 20 && snap.Session.MapCols == 30 {
			break
		}
	}

	// Add enemy, hidden trap, and chest item across rectangular dimensions
	addPayloads := []map[string]any{
		{
			"action":            "ADD_MAP_ENTITY",
			"entity_kind":       "enemy",
			"entity_name":       "Goblin",
			"target_x":          28,
			"target_y":          18,
			"entity_size":       1,
			"entity_color":      "#ef4444",
			"entity_hp_current": 7,
			"entity_hp_max":     7,
			"entity_note":       "Arco corto",
			"entity_hidden":     false,
		},
		{
			"action":            "ADD_MAP_ENTITY",
			"entity_kind":       "trap",
			"entity_name":       "Foso Oculto",
			"target_x":          15,
			"target_y":          10,
			"entity_size":       1,
			"entity_color":      "#f97316",
			"entity_hp_current": 0,
			"entity_hp_max":     0,
			"entity_note":       "DC 14 Percepción",
			"entity_hidden":     true,
		},
		{
			"action":            "ADD_MAP_ENTITY",
			"entity_kind":       "item",
			"entity_name":       "Cofre Antiguo",
			"target_x":          5,
			"target_y":          4,
			"entity_size":       1,
			"entity_color":      "#eab308",
			"entity_hp_current": 0,
			"entity_hp_max":     0,
			"entity_hidden":     false,
		},
	}
	for _, ap := range addPayloads {
		b, _ := json.Marshal(ap)
		if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: b}); err != nil {
			t.Fatal(err)
		}
	}

	var goblinID string
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		if err := json.Unmarshal(msg.Payload, &snap); err != nil {
			t.Fatal(err)
		}
		if len(snap.MapEntities) == 3 {
			for _, ent := range snap.MapEntities {
				if ent.Kind == "enemy" && ent.Name == "Goblin" {
					goblinID = ent.ID
					if ent.X != 28 || ent.Y != 18 {
						t.Fatalf("expected goblin at (28,18), got (%d,%d)", ent.X, ent.Y)
					}
				}
			}
			if goblinID != "" {
				break
			}
		}
	}

	// Move goblin to (29, 19)
	moveEntity, _ := json.Marshal(map[string]any{
		"action":    "MOVE_MAP_ENTITY",
		"entity_id": goblinID,
		"target_x":  29,
		"target_y":  19,
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: moveEntity}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		found := false
		for _, ent := range snap.MapEntities {
			if ent.ID == goblinID && ent.X == 29 && ent.Y == 19 {
				found = true
			}
		}
		if found {
			break
		}
	}

	// Update HP & toggle stealth hidden
	updEntity, _ := json.Marshal(map[string]any{
		"action":            "UPDATE_MAP_ENTITY",
		"entity_id":         goblinID,
		"entity_hp_current": 3,
		"entity_hp_max":     7,
		"entity_hidden":     true,
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: updEntity}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		found := false
		for _, ent := range snap.MapEntities {
			if ent.ID == goblinID && ent.HPCurrent == 3 && ent.IsHidden {
				found = true
			}
		}
		if found {
			break
		}
	}

	// Shrink map to 10x10 and verify goblin clamps to (9, 9)
	shrinkCfg, _ := json.Marshal(map[string]any{
		"action":      "UPDATE_MAP_CONFIG",
		"map_enabled": true,
		"map_rows":    10,
		"map_cols":    10,
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: shrinkCfg}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if snap.Session.MapRows == 10 && snap.Session.MapCols == 10 {
			for _, ent := range snap.MapEntities {
				if ent.ID == goblinID && (ent.X > 9 || ent.Y > 9) {
					t.Fatalf("expected goblin clamped <= 9, got (%d,%d)", ent.X, ent.Y)
				}
			}
			break
		}
	}

	// Delete goblin, then clear remaining entities
	delEntity, _ := json.Marshal(map[string]any{
		"action":    "DELETE_MAP_ENTITY",
		"entity_id": goblinID,
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: delEntity}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if len(snap.MapEntities) == 2 {
			break
		}
	}

	clearEntities, _ := json.Marshal(map[string]any{
		"action": "CLEAR_MAP_ENTITIES",
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: clearEntities}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if len(snap.MapEntities) == 0 {
			break
		}
	}
}

func TestFoundryCompanionCampaignsPrivacyNotesChatAndBackup(t *testing.T) {
	_, ts := setupTestServer(t)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Connect DM, Player 1 (Aria), and Player 2 (Borin)
	dmConn, _, err := websocket.Dial(ctx, wsURL+"?role=dm&pin=8492", nil)
	if err != nil {
		t.Fatalf("dial dm: %v", err)
	}
	defer dmConn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, dmConn, "STATE_SYNC")

	p1Conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial p1: %v", err)
	}
	defer p1Conn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, p1Conn, "STATE_SYNC")

	j1, _ := json.Marshal(map[string]any{"name": "Aria", "initiative": 18, "race": "elf", "color": "#a855f7"})
	if err := wsjson.Write(ctx, p1Conn, server.WSMessage{Event: "JOIN_ROOM", Payload: j1}); err != nil {
		t.Fatal(err)
	}
	p1ID := readUntilEvent(t, ctx, p1Conn, "JOIN_ACK").PlayerID

	p2Conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial p2: %v", err)
	}
	defer p2Conn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, p2Conn, "STATE_SYNC")

	j2, _ := json.Marshal(map[string]any{"name": "Borin", "initiative": 12, "race": "dwarf", "color": "#f59e0b"})
	if err := wsjson.Write(ctx, p2Conn, server.WSMessage{Event: "JOIN_ROOM", Payload: j2}); err != nil {
		t.Fatal(err)
	}
	p2ID := readUntilEvent(t, ctx, p2Conn, "JOIN_ACK").PlayerID

	// 1. Campaign creation + session lifecycle
	createCamp, _ := json.Marshal(map[string]any{
		"action":          "CREATE_CAMPAIGN",
		"campaign_name":   "Tumba de Aniquilación",
		"campaign_system": "D&D 5e",
		"campaign_desc":   "Exploración en Chult",
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: createCamp}); err != nil {
		t.Fatal(err)
	}
	var snap server.StateSnapshot
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if snap.ActiveCampaign.Name == "Tumba de Aniquilación" {
			break
		}
	}

	startSess, _ := json.Marshal(map[string]any{
		"action":        "START_CAMPAIGN_SESSION",
		"session_title": "Sesión 2 — Selva",
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: startSess}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if len(snap.CampaignSessions) > 0 && snap.CampaignSessions[0].Title == "Sesión 2 — Selva" {
			break
		}
	}

	// 2. Blind GM_ONLY roll with AST formula + commandId idempotency + strict server-side audience isolation
	blindRoll, _ := json.Marshal(map[string]any{
		"type":          "DICE",
		"dice_notation": "2d20kh1",
		"visibility":    "GM_ONLY",
		"command_id":    "cmd-blind-1",
	})
	if err := wsjson.Write(ctx, p1Conn, server.WSMessage{Event: "ROLL_ACTION", Payload: blindRoll}); err != nil {
		t.Fatal(err)
	}

	dmRB := readUntilEvent(t, ctx, dmConn, "RESULT_BROADCAST")
	var dmRoll server.RollBroadcast
	_ = json.Unmarshal(dmRB.Payload, &dmRoll)
	if dmRoll.Masked || dmRoll.Detail == nil {
		t.Fatalf("expected unmasked GM_ONLY roll for DM, got %+v", dmRoll)
	}

	p1RB := readUntilEvent(t, ctx, p1Conn, "RESULT_BROADCAST")
	var p1Roll server.RollBroadcast
	_ = json.Unmarshal(p1RB.Payload, &p1Roll)
	if !p1Roll.Masked || p1Roll.Detail != nil {
		t.Fatalf("expected masked blind roll for roller, got %+v", p1Roll)
	}

	// Duplicate retry with identical command_id must NOT duplicate action_log entries
	if err := wsjson.Write(ctx, p1Conn, server.WSMessage{Event: "ROLL_ACTION", Payload: blindRoll}); err != nil {
		t.Fatal(err)
	}
	_ = readUntilEvent(t, ctx, p1Conn, "RESULT_BROADCAST")

	dmStateResp, err := http.Get(ts.URL + "/api/v1/state?role=dm")
	if err != nil {
		t.Fatal(err)
	}
	var dmState server.StateSnapshot
	_ = json.NewDecoder(dmStateResp.Body).Decode(&dmState)
	dmStateResp.Body.Close()

	blindCount := 0
	for _, entry := range dmState.ActionLog {
		if entry.CommandID == "cmd-blind-1" {
			blindCount++
		}
	}
	if blindCount != 1 {
		t.Fatalf("expected exactly 1 log entry for idempotent command_id, got %d", blindCount)
	}

	// Also send ROLLER_ONLY roll by Aria and ensure Borin NEVER sees Aria's private or blind rolls via /api/v1/state
	privRoll, _ := json.Marshal(map[string]any{
		"type":          "DICE",
		"dice_notation": "1d20+5",
		"visibility":    "ROLLER_ONLY",
		"command_id":    "cmd-priv-1",
	})
	if err := wsjson.Write(ctx, p1Conn, server.WSMessage{Event: "ROLL_ACTION", Payload: privRoll}); err != nil {
		t.Fatal(err)
	}
	_ = readUntilEvent(t, ctx, p1Conn, "RESULT_BROADCAST")

	p2StateResp, err := http.Get(ts.URL + "/api/v1/state?player_id=" + p2ID)
	if err != nil {
		t.Fatal(err)
	}
	var p2State server.StateSnapshot
	_ = json.NewDecoder(p2StateResp.Body).Decode(&p2State)
	p2StateResp.Body.Close()
	for _, entry := range p2State.ActionLog {
		if entry.CommandID == "cmd-blind-1" || entry.CommandID == "cmd-priv-1" {
			t.Fatalf("Borin received restricted roll log entry: %+v", entry)
		}
	}

	// 3. Notes isolation + optimistic version conflict (409 Conflict)
	noteReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/notes", strings.NewReader(`{
		"title": "Secreto de Aria",
		"body": "Llave escondida",
		"visibility": "PRIVATE",
		"allow_edit": false
	}`))
	noteReq.Header.Set("Content-Type", "application/json")
	noteReq.Header.Set("X-Player-ID", p1ID)
	noteRes, err := http.DefaultClient.Do(noteReq)
	if err != nil || noteRes.StatusCode != http.StatusCreated {
		t.Fatalf("create private note failed: err=%v status=%v", err, noteRes)
	}
	noteRes.Body.Close()

	p2NotesResp, err := http.Get(ts.URL + "/api/v1/notes?player_id=" + p2ID)
	if err != nil {
		t.Fatal(err)
	}
	var p2NotesPayload struct {
		Notes []store.CampaignNote `json:"notes"`
	}
	_ = json.NewDecoder(p2NotesResp.Body).Decode(&p2NotesPayload)
	p2NotesResp.Body.Close()
	if len(p2NotesPayload.Notes) != 0 {
		t.Fatalf("Borin must not see Aria's PRIVATE note, got %+v", p2NotesPayload.Notes)
	}

	sharedReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/notes", strings.NewReader(`{
		"title": "Diario del Grupo",
		"body": "Dia 1",
		"visibility": "CAMPAIGN",
		"allow_edit": true
	}`))
	sharedReq.Header.Set("Content-Type", "application/json")
	sharedReq.Header.Set("X-Player-ID", p1ID)
	sharedRes, err := http.DefaultClient.Do(sharedReq)
	if err != nil || sharedRes.StatusCode != http.StatusCreated {
		t.Fatalf("create campaign note failed: err=%v status=%v", err, sharedRes)
	}
	var createdNote store.CampaignNote
	_ = json.NewDecoder(sharedRes.Body).Decode(&createdNote)
	sharedRes.Body.Close()

	patchOK, _ := http.NewRequest(http.MethodPatch, ts.URL+"/api/v1/notes/"+createdNote.ID, strings.NewReader(`{
		"expected_version": 1,
		"title": "Diario del Grupo",
		"body": "Dia 1 y 2"
	}`))
	patchOK.Header.Set("Content-Type", "application/json")
	patchOK.Header.Set("X-Player-ID", p2ID)
	patchOKRes, err := http.DefaultClient.Do(patchOK)
	if err != nil || patchOKRes.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on collaborative note update, got %d (%v)", patchOKRes.StatusCode, err)
	}
	patchOKRes.Body.Close()

	// Stale expected_version=1 must fail with 409 Conflict
	patchStale, _ := http.NewRequest(http.MethodPatch, ts.URL+"/api/v1/notes/"+createdNote.ID, strings.NewReader(`{
		"expected_version": 1,
		"title": "Diario del Grupo",
		"body": "Sobrescritura conflictiva"
	}`))
	patchStale.Header.Set("Content-Type", "application/json")
	patchStale.Header.Set("X-Player-ID", p1ID)
	patchStaleRes, err := http.DefaultClient.Do(patchStale)
	if err != nil {
		t.Fatal(err)
	}
	patchStaleRes.Body.Close()
	if patchStaleRes.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on stale note version, got %d", patchStaleRes.StatusCode)
	}

	// 4. GM_WHISPER chat isolation
	whisperPayload, _ := json.Marshal(map[string]any{
		"body":       "Susurro secreto al DM",
		"visibility": "GM_WHISPER",
		"command_id": "chat-wh-1",
	})
	if err := wsjson.Write(ctx, p1Conn, server.WSMessage{Event: "CHAT_SEND", Payload: whisperPayload}); err != nil {
		t.Fatal(err)
	}
	_ = readUntilEvent(t, ctx, dmConn, "CHAT_MESSAGE")

	p2AfterChat, _ := http.Get(ts.URL + "/api/v1/state?player_id=" + p2ID)
	var p2ChatSnap server.StateSnapshot
	_ = json.NewDecoder(p2AfterChat.Body).Decode(&p2ChatSnap)
	p2AfterChat.Body.Close()
	if len(p2ChatSnap.ChatMessages) != 0 {
		t.Fatalf("Borin must not see Aria's GM_WHISPER, got %+v", p2ChatSnap.ChatMessages)
	}

	// 5. Membership revocation blocks open WS commands
	revokePayload, _ := json.Marshal(map[string]any{
		"action":            "SET_MEMBERSHIP_STATUS",
		"target_player_id":  p2ID,
		"membership_status": "REVOKED",
	})
	if err := wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: revokePayload}); err != nil {
		t.Fatal(err)
	}
	revMsg := readUntilEvent(t, ctx, p2Conn, "MEMBERSHIP_REVOKED")
	if revMsg.PlayerID != p2ID {
		t.Fatalf("expected MEMBERSHIP_REVOKED for Borin")
	}

	// 6. Export campaign bundle (verify checksum rejection on tampering) & Full ZIP Backup/Restore in clean server
	expResp, err := http.Get(ts.URL + "/api/v1/campaigns/export")
	if err != nil || expResp.StatusCode != http.StatusOK {
		t.Fatalf("export campaign failed: %v", err)
	}
	var bundle store.CampaignBundle
	_ = json.NewDecoder(expResp.Body).Decode(&bundle)
	expResp.Body.Close()

	bundle.ChecksumSHA256 = "0000badchecksum"
	badBundleBytes, _ := json.Marshal(bundle)
	badImp, err := http.Post(ts.URL+"/api/v1/campaigns/import", "application/json", bytes.NewReader(badBundleBytes))
	if err != nil {
		t.Fatal(err)
	}
	badImp.Body.Close()
	if badImp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 on tampered SHA-256 bundle, got %d", badImp.StatusCode)
	}

	zipResp, err := http.Get(ts.URL + "/api/v1/backups/download")
	if err != nil || zipResp.StatusCode != http.StatusOK {
		t.Fatalf("backup zip failed: %v", err)
	}
	zipBytes, _ := io.ReadAll(zipResp.Body)
	zipResp.Body.Close()

	// Restore into a completely fresh server instance
	_, tsClean := setupTestServer(t)
	restoreResp, err := http.Post(tsClean.URL+"/api/v1/backups/restore", "application/zip", bytes.NewReader(zipBytes))
	if err != nil {
		t.Fatal(err)
	}
	restoreResp.Body.Close()
	if restoreResp.StatusCode != http.StatusOK {
		t.Fatalf("restore zip failed with status %d", restoreResp.StatusCode)
	}

	cleanStateResp, err := http.Get(tsClean.URL + "/api/v1/state?role=dm")
	if err != nil {
		t.Fatal(err)
	}
	var restoredSnap server.StateSnapshot
	_ = json.NewDecoder(cleanStateResp.Body).Decode(&restoredSnap)
	cleanStateResp.Body.Close()
	if restoredSnap.ActiveCampaign.Name != "Tumba de Aniquilación" || len(restoredSnap.Players) != 2 {
		t.Fatalf("expected restored campaign & 2 players, got %s players=%d", restoredSnap.ActiveCampaign.Name, len(restoredSnap.Players))
	}
}

func TestV150CertificatesScenesFogMobRollAndTemporaryEvents(t *testing.T) {
	srv, ts := setupTestServer(t)

	// 1. Solution 1 & 2 TLS/Tunnel status endpoint + .sslip.io SAN on generated leaf certificate
	tlsResp, err := http.Get(ts.URL + "/api/v1/tls/status")
	if err != nil {
		t.Fatal(err)
	}
	var tlsStatus struct {
		CACertHTTPURL       string              `json:"ca_cert_http_url"`
		CAFingerprintSHA256 string              `json:"ca_fingerprint_sha256"`
		SSLIPHTTPSURL       string              `json:"sslip_https_url"`
		Tunnel              server.TunnelStatus `json:"tunnel"`
	}
	if err := json.NewDecoder(tlsResp.Body).Decode(&tlsStatus); err != nil {
		t.Fatal(err)
	}
	tlsResp.Body.Close()

	if tlsStatus.CACertHTTPURL != "http://192.168.1.42:8080/api/v1/tls/ca.crt" {
		t.Fatalf("unexpected ca_cert_http_url: %s", tlsStatus.CACertHTTPURL)
	}
	if !strings.Contains(tlsStatus.SSLIPHTTPSURL, "192-168-1-42.sslip.io") {
		t.Fatalf("expected .sslip.io HTTPS URL, got %s", tlsStatus.SSLIPHTTPSURL)
	}
	if tlsStatus.CAFingerprintSHA256 == "" || tlsStatus.Tunnel.Active {
		t.Fatalf("unexpected TLS fingerprint/tunnel status: %+v", tlsStatus)
	}
	if srv.TLSConfig == nil || len(srv.TLSConfig.Certificates) == 0 || len(srv.TLSConfig.Certificates[0].Certificate) == 0 {
		t.Fatalf("expected generated leaf TLS certificate on server")
	}
	leafCert, err := x509.ParseCertificate(srv.TLSConfig.Certificates[0].Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf cert: %v", err)
	}
	foundSSLIP := false
	for _, dnsName := range leafCert.DNSNames {
		if dnsName == "192-168-1-42.sslip.io" {
			foundSSLIP = true
			break
		}
	}
	if !foundSSLIP {
		t.Fatalf("expected 192-168-1-42.sslip.io in cert SANs %v", leafCert.DNSNames)
	}

	// 2. Connect DM and 2 players
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	dmConn, _, err := websocket.Dial(ctx, wsURL+"?role=dm&pin=8492", nil)
	if err != nil {
		t.Fatalf("dial DM: %v", err)
	}
	defer dmConn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, dmConn, "STATE_SYNC")

	p1Conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial p1: %v", err)
	}
	defer p1Conn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, p1Conn, "STATE_SYNC")
	p1Join, _ := json.Marshal(map[string]any{"name": "Aria", "initiative": 18, "race": "elf", "color": "#a855f7"})
	_ = wsjson.Write(ctx, p1Conn, server.WSMessage{Event: "JOIN_ROOM", Payload: p1Join})
	p1Ack := readUntilEvent(t, ctx, p1Conn, "JOIN_ACK")

	p2Conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial p2: %v", err)
	}
	defer p2Conn.Close(websocket.StatusNormalClosure, "done")
	_ = readUntilEvent(t, ctx, p2Conn, "STATE_SYNC")
	p2Join, _ := json.Marshal(map[string]any{"name": "Borin", "initiative": 10, "race": "dwarf", "color": "#f59e0b"})
	_ = wsjson.Write(ctx, p2Conn, server.WSMessage{Event: "JOIN_ROOM", Payload: p2Join})
	_ = readUntilEvent(t, ctx, p2Conn, "JOIN_ACK")

	// 3. Fari Scene Cards & Progress Clocks + Fog of War + Multi-Scene Save/Activate
	cardsPayload, _ := json.Marshal(map[string]any{
		"action": "SET_SCENE_CARDS",
		"scene_cards": []store.SceneCard{
			{ID: "c1", Title: "Ritual del Altar", Subtitle: "Se completa en 4 segmentos", Kind: "clock", Segments: 4, Filled: 2},
			{ID: "c2", Title: "Suelo Resbaladizo", Subtitle: "DES DC 12 al correr", Kind: "aspect"},
		},
	})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: cardsPayload})

	fogEnabled := true
	fogPayload, _ := json.Marshal(map[string]any{
		"action":       "UPDATE_FOG",
		"fog_enabled":  fogEnabled,
		"fog_revealed": []string{"1,1", "2,1"},
	})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: fogPayload})

	var snap server.StateSnapshot
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if len(snap.Session.SceneCards) == 2 && snap.Session.FogEnabled && len(snap.Session.FogRevealed) == 2 {
			break
		}
	}
	origCols, origRows := snap.Session.MapCols, snap.Session.MapRows

	saveScenePayload, _ := json.Marshal(map[string]any{"action": "SAVE_SCENE", "scene_name": "Cripta Norte"})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: saveScenePayload})
	var savedSceneID string
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if len(snap.MapScenes) > 0 {
			savedSceneID = snap.MapScenes[0].ID
			break
		}
	}

	resizePayload, _ := json.Marshal(map[string]any{"action": "UPDATE_MAP_CONFIG", "map_cols": 25, "map_rows": 30})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: resizePayload})
	fogOffPayload, _ := json.Marshal(map[string]any{"action": "UPDATE_FOG", "fog_enabled": false})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: fogOffPayload})
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if snap.Session.MapCols == 25 && snap.Session.MapRows == 30 && !snap.Session.FogEnabled {
			break
		}
	}

	activatePayload, _ := json.Marshal(map[string]any{"action": "ACTIVATE_SCENE", "scene_id": savedSceneID})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: activatePayload})
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if snap.Session.MapCols == origCols && snap.Session.MapRows == origRows && snap.Session.FogEnabled {
			break
		}
	}

	// 4. Round counter auto-increments on full turn wrap (0 -> 1 -> 0 => Round 2)
	nextTurnPayload, _ := json.Marshal(map[string]any{"action": "NEXT_TURN"})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: nextTurnPayload})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: nextTurnPayload})
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		if snap.Session.RoundNumber >= 2 {
			break
		}
	}

	// 5. Mob Controller bulk attack broadcast
	mobPayload, _ := json.Marshal(map[string]any{
		"action":           "MOB_ROLL",
		"mob_name":         "Kobold",
		"mob_count":        5,
		"mob_atk_bonus":    4,
		"mob_target_ac":    14,
		"mob_dmg_notation": "1d6+2",
		"mob_visibility":   "PUBLIC",
	})
	_ = wsjson.Write(ctx, dmConn, server.WSMessage{Event: "DM_OVERRIDE", Payload: mobPayload})
	mobRB := readUntilEvent(t, ctx, p1Conn, "RESULT_BROADCAST")
	var mobBroadcast server.RollBroadcast
	_ = json.Unmarshal(mobRB.Payload, &mobBroadcast)
	if mobBroadcast.SetType != "DICE" || !strings.Contains(mobBroadcast.ResultSummary, "Horda Kobold") {
		t.Fatalf("unexpected MOB_ROLL broadcast: %+v", mobBroadcast)
	}

	// 6. Player Tactical State update (conditions + aura + quick sheet stats)
	tactPayload, _ := json.Marshal(map[string]any{
		"target_player_id": p1Ack.PlayerID,
		"conditions":       []string{"concentration", "blessed"},
		"aura_radius":      10,
		"aura_color":       "#fbbf24",
		"stats_json":       map[string]any{"hp_current": 24, "hp_max": 28, "ac": 16},
	})
	_ = wsjson.Write(ctx, p1Conn, server.WSMessage{Event: "UPDATE_TACTICAL_PLAYER", Payload: tactPayload})
	for {
		msg := readUntilEvent(t, ctx, dmConn, "STATE_SYNC")
		_ = json.Unmarshal(msg.Payload, &snap)
		foundUpdated := false
		for _, pl := range snap.Players {
			if pl.ID == p1Ack.PlayerID && pl.AuraRadius == 10 && len(pl.Conditions) == 2 {
				foundUpdated = true
			}
		}
		if foundUpdated {
			break
		}
	}

	// 7. Zero-DB ephemeral TEMPORARY_MAP_EVENT broadcast relay (Ping / Ruler / Sound)
	pingPayload, _ := json.Marshal(map[string]any{"kind": "ping", "x": 3, "y": 4, "sender_name": "Aria"})
	_ = wsjson.Write(ctx, p1Conn, server.WSMessage{Event: "TEMPORARY_MAP_EVENT", Payload: pingPayload})
	tempMsg := readUntilEvent(t, ctx, dmConn, "TEMPORARY_MAP_EVENT")
	var tempBody map[string]any
	_ = json.Unmarshal(tempMsg.Payload, &tempBody)
	if tempBody["kind"] != "ping" {
		t.Fatalf("expected TEMPORARY_MAP_EVENT kind=ping, got %+v", tempBody)
	}
}
