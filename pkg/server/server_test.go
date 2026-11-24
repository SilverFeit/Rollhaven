package server_test

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
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
	if health["lan_ip"] != "192.168.1.42" || health["app"] != "Rollhaven" || health["version"] != "1.3.0" || health["license"] != "MIT" {
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
