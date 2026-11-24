package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/SilverFeit/Rollhaven/pkg/engine"
	"github.com/SilverFeit/Rollhaven/pkg/store"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// WSMessage is the canonical JSON envelope exchanged over /ws.
type WSMessage struct {
	Event    string          `json:"event"`
	PlayerID string          `json:"player_id,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`
}

// RollBroadcast represents a single roll/decision result transmitted to authorized connected screens.
type RollBroadcast struct {
	ID            int64     `json:"id"`
	Timestamp     time.Time `json:"timestamp"`
	PlayerID      string    `json:"player_id"`
	PlayerName    string    `json:"player_name"`
	PlayerColor   string    `json:"player_color"`
	RaceIcon      string    `json:"race_icon"`
	SetType       string    `json:"set_type"`
	ResultSummary string    `json:"result_summary"`
	Detail        any       `json:"detail"`
	Visibility    string    `json:"visibility,omitempty"`
	CommandID     string    `json:"command_id,omitempty"`
	Masked        bool      `json:"masked,omitempty"`
	IsCritical    bool      `json:"is_critical,omitempty"`
	IsFumble      bool      `json:"is_fumble,omitempty"`
	IsEdge        bool      `json:"is_edge,omitempty"`
	OutOfTurn     bool      `json:"out_of_turn,omitempty"`
}

// StateSnapshot is pushed via STATE_SYNC, filtered per recipient audience on the server.
type StateSnapshot struct {
	Sequence         int64                   `json:"sequence"`
	Session          store.Session           `json:"session"`
	ActiveCampaign   store.Campaign          `json:"active_campaign"`
	Campaigns        []store.Campaign        `json:"campaigns"`
	CampaignSessions []store.CampaignSession `json:"campaign_sessions"`
	Users            []store.User            `json:"users"`
	Characters       []store.Character       `json:"characters"`
	Players          []store.Player          `json:"players"`
	MapEntities      []store.MapEntity       `json:"map_entities"`
	MapScenes        []store.MapScene        `json:"map_scenes"`
	CampaignNotes    []store.CampaignNote    `json:"campaign_notes"`
	ChatMessages     []store.ChatMessage     `json:"chat_messages"`
	RollTables       []store.RollTable       `json:"roll_tables"`
	AuditEvents      []store.AuditEvent      `json:"audit_events,omitempty"`
	CurrentTurnIndex int                     `json:"current_turn_index"`
	ActivePlayerID   string                  `json:"active_player_id"`
	CurrentTurnRolls []RollBroadcast         `json:"current_turn_rolls"`
	LastResult       *RollBroadcast          `json:"last_result,omitempty"`
	ActionLog        []store.ActionLogEntry  `json:"action_log"`
	StrictTurnRolls  bool                    `json:"strict_turn_rolls"`
	StrictTurnMove   bool                    `json:"strict_turn_move"`
	LanIP            string                  `json:"lan_ip"`
	Port             int                     `json:"port"`
}

type wsClient struct {
	conn      *websocket.Conn
	playerID  string
	isDM      bool
	clientIP  string
	userAgent string
	sendMu    sync.Mutex
	cancel    context.CancelFunc
}

type clientTarget struct {
	client   *wsClient
	playerID string
	isDM     bool
}

// Hub coordinates WebSocket clients, campaign state, privacy-filtered sync, turns, and broadcasts.
type Hub struct {
	store  *store.Store
	lanIP  string
	port   int
	dmPIN  string
	tunnel *TunnelManager

	mu               sync.RWMutex
	closed           bool
	sequence         int64
	clients          map[*wsClient]struct{}
	currentTurnRolls []RollBroadcast
	lastResult       *RollBroadcast
	strictTurnRolls  bool
	strictTurnMove   bool
}

// Close marks the hub closed, stops any active public tunnel, and terminates WebSocket clients cleanly.
func (h *Hub) Close() {
	if h.tunnel != nil {
		_ = h.tunnel.Stop()
	}
	h.mu.Lock()
	h.closed = true
	targets := make([]*wsClient, 0, len(h.clients))
	for c := range h.clients {
		targets = append(targets, c)
	}
	h.mu.Unlock()
	for _, c := range targets {
		c.cancel()
		_ = c.conn.Close(websocket.StatusGoingAway, "server shutting down")
	}
}

// NewHub builds a Hub bound to a SQLite store, detected LAN IP, port, and 4-digit DM PIN.
func NewHub(st *store.Store, lanIP string, port int, dmPIN string) *Hub {
	return &Hub{
		store:   st,
		lanIP:   lanIP,
		port:    port,
		dmPIN:   dmPIN,
		clients: make(map[*wsClient]struct{}),
	}
}

func (h *Hub) nextSequence() int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sequence++
	return h.sequence
}

func (h *Hub) getClientIdentity(c *wsClient) (playerID string, isDM bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return c.playerID, c.isDM
}

func (h *Hub) setClientPlayerID(c *wsClient, pid string) {
	h.mu.Lock()
	c.playerID = pid
	h.mu.Unlock()
}

func (h *Hub) setClientDM(c *wsClient, dm bool) {
	h.mu.Lock()
	c.isDM = dm
	h.mu.Unlock()
}

func (h *Hub) register(c *wsClient) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) unregister(c *wsClient) {
	h.mu.Lock()
	closed := h.closed
	delete(h.clients, c)
	playerID := c.playerID
	stillOnline := false
	if playerID != "" {
		for other := range h.clients {
			if other.playerID == playerID {
				stillOnline = true
				break
			}
		}
	}
	h.mu.Unlock()

	if !closed && playerID != "" && !stillOnline {
		_ = h.store.SetPlayerConnection(playerID, false, "", "", -1)
		h.BroadcastStateSync()
	}
}

func (h *Hub) sendToClient(ctx context.Context, c *wsClient, msg any) error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return wsjson.Write(wctx, c.conn, msg)
}

func (h *Hub) snapshotTargets() []clientTarget {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.closed {
		return nil
	}
	targets := make([]clientTarget, 0, len(h.clients))
	for c := range h.clients {
		targets = append(targets, clientTarget{
			client:   c,
			playerID: c.playerID,
			isDM:     c.isDM,
		})
	}
	return targets
}

func maskBlindRoll(rb RollBroadcast) RollBroadcast {
	cp := rb
	cp.ResultSummary = "Tirada ciega enviada al GM (resultado oculto)"
	cp.Detail = nil
	cp.IsCritical = false
	cp.IsFumble = false
	cp.IsEdge = false
	cp.Masked = true
	return cp
}

func filterRollForViewer(rb RollBroadcast, viewerID string, isDM bool) (RollBroadcast, bool) {
	vis := store.NormalizeRollVisibility(rb.Visibility)
	if store.CanViewScopedItem(vis, rb.PlayerID, viewerID, isDM) {
		return rb, true
	}
	if vis == "GM_ONLY" && viewerID != "" && rb.PlayerID == viewerID && !isDM {
		return maskBlindRoll(rb), true
	}
	return RollBroadcast{}, false
}

// BuildSnapshot constructs a DM-level snapshot from SQLite and hub memory.
func (h *Hub) BuildSnapshot() (StateSnapshot, error) {
	return h.BuildSnapshotFor("", true)
}

// BuildSnapshotFor constructs an audience-filtered STATE_SYNC payload strictly scoped to (viewerID, isDM).
func (h *Hub) BuildSnapshotFor(viewerID string, isDM bool) (StateSnapshot, error) {
	sess, err := h.store.GetSession()
	if err != nil {
		return StateSnapshot{}, err
	}
	activeCamp, _ := h.store.GetActiveCampaign()
	campaigns, _ := h.store.ListCampaigns()
	campSessions, _ := h.store.ListCampaignSessions(activeCamp.ID)
	users, _ := h.store.ListUsers()
	characters, _ := h.store.ListCharacters(activeCamp.ID)
	players, err := h.store.ListPlayersOrdered()
	if err != nil {
		return StateSnapshot{}, err
	}
	rawEntities, err := h.store.ListMapEntities()
	if err != nil {
		return StateSnapshot{}, err
	}
	mapEntities := make([]store.MapEntity, 0, len(rawEntities))
	for _, ent := range rawEntities {
		if !isDM && ent.IsHidden {
			continue
		}
		mapEntities = append(mapEntities, ent)
	}

	notes, _ := h.store.ListCampaignNotesForViewer(activeCamp.ID, viewerID, isDM)
	mapScenes, _ := h.store.ListMapScenes(activeCamp.ID)
	chats, _ := h.store.ListChatMessagesForViewer(activeCamp.ID, viewerID, isDM, 100)
	rollTables, _ := h.store.ListRollTables(activeCamp.ID)
	logs, err := h.store.ListActionLogForViewer(activeCamp.ID, viewerID, isDM, 60)
	if err != nil {
		return StateSnapshot{}, err
	}

	var audits []store.AuditEvent
	if isDM {
		audits, _ = h.store.ListAuditEvents(activeCamp.ID, 50)
	}

	turnIdx := sess.CurrentTurnIndex
	if len(players) == 0 {
		turnIdx = 0
	} else if turnIdx >= len(players) {
		turnIdx = 0
		_ = h.store.UpdateCurrentTurnIndex(0)
	}
	activeID := ""
	if len(players) > 0 && turnIdx >= 0 && turnIdx < len(players) {
		activeID = players[turnIdx].ID
	}

	h.mu.RLock()
	seq := h.sequence
	rawRolls := make([]RollBroadcast, len(h.currentTurnRolls))
	copy(rawRolls, h.currentTurnRolls)
	strictRolls := h.strictTurnRolls
	strictMove := h.strictTurnMove
	h.mu.RUnlock()

	filteredRolls := make([]RollBroadcast, 0, len(rawRolls))
	for _, rb := range rawRolls {
		if viewRB, ok := filterRollForViewer(rb, viewerID, isDM); ok {
			filteredRolls = append(filteredRolls, viewRB)
		}
	}

	var lastCopy *RollBroadcast
	if len(filteredRolls) > 0 {
		cp := filteredRolls[len(filteredRolls)-1]
		lastCopy = &cp
	}

	return StateSnapshot{
		Sequence:         seq,
		Session:          sess,
		ActiveCampaign:   activeCamp,
		Campaigns:        campaigns,
		CampaignSessions: campSessions,
		Users:            users,
		Characters:       characters,
		Players:          players,
		MapEntities:      mapEntities,
		MapScenes:        mapScenes,
		CampaignNotes:    notes,
		ChatMessages:     chats,
		RollTables:       rollTables,
		AuditEvents:      audits,
		CurrentTurnIndex: turnIdx,
		ActivePlayerID:   activeID,
		CurrentTurnRolls: filteredRolls,
		LastResult:       lastCopy,
		ActionLog:        logs,
		StrictTurnRolls:  strictRolls,
		StrictTurnMove:   strictMove,
		LanIP:            h.lanIP,
		Port:             h.port,
	}, nil
}

// BroadcastStateSync pushes an audience-filtered STATE_SYNC snapshot to every connected WebSocket client.
func (h *Hub) BroadcastStateSync() {
	h.nextSequence()
	targets := h.snapshotTargets()
	if len(targets) == 0 {
		return
	}

	// Deduplicate serialized snapshots by (viewerID, isDM) identity to avoid redundant SQL reads.
	type viewKey struct {
		pid  string
		isDM bool
	}
	cache := make(map[viewKey]json.RawMessage)

	for _, t := range targets {
		k := viewKey{pid: t.playerID, isDM: t.isDM}
		raw, ok := cache[k]
		if !ok {
			snap, err := h.BuildSnapshotFor(t.playerID, t.isDM)
			if err != nil {
				if !strings.Contains(err.Error(), "database is closed") {
					log.Printf("build state snapshot error: %v", err)
				}
				return
			}
			b, _ := json.Marshal(snap)
			raw = b
			cache[k] = raw
		}

		msg := WSMessage{Event: "STATE_SYNC", Payload: raw}
		go func(cl *wsClient, m WSMessage) {
			_ = h.sendToClient(context.Background(), cl, m)
		}(t.client, msg)
	}
}

func (h *Hub) sendStateSyncTo(ctx context.Context, c *wsClient) {
	pid, isDM := h.getClientIdentity(c)
	snap, err := h.BuildSnapshotFor(pid, isDM)
	if err != nil {
		return
	}
	raw, _ := json.Marshal(snap)
	_ = h.sendToClient(ctx, c, WSMessage{
		Event:   "STATE_SYNC",
		Payload: raw,
	})
}

func (h *Hub) sendError(ctx context.Context, c *wsClient, message string) {
	raw, _ := json.Marshal(map[string]string{"message": message})
	_ = h.sendToClient(ctx, c, WSMessage{
		Event:   "ERROR",
		Payload: raw,
	})
}

func (h *Hub) ensureNotRevoked(ctx context.Context, c *wsClient) bool {
	pid, isDM := h.getClientIdentity(c)
	if isDM || pid == "" {
		return true
	}
	p, err := h.store.GetPlayer(pid)
	if err == nil && strings.ToUpper(p.MembershipStatus) == "REVOKED" {
		_ = h.sendToClient(ctx, c, WSMessage{Event: "MEMBERSHIP_REVOKED", PlayerID: pid})
		h.sendError(ctx, c, "Tu membresía en esta campaña ha sido revocada por el GM")
		c.cancel()
		_ = c.conn.Close(websocket.StatusPolicyViolation, "membership revoked")
		return false
	}
	return true
}

// HandleWS upgrades an HTTP connection to WebSocket, starts the 15s heartbeat, and dispatches incoming events.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	clientIP := extractClientIP(r)
	ua := r.UserAgent()
	role := r.URL.Query().Get("role")
	pin := r.URL.Query().Get("pin")
	if pin == "" {
		if ck, err := r.Cookie("rollhaven_dm_pin"); err == nil {
			pin = ck.Value
		}
	}
	playerID := strings.TrimSpace(r.URL.Query().Get("player_id"))

	isDM := false
	if role == "dm" && (isLocalhostIP(clientIP) || (h.dmPIN != "" && pin == h.dmPIN)) {
		isDM = true
	}

	client := &wsClient{
		conn:      conn,
		playerID:  playerID,
		isDM:      isDM,
		clientIP:  clientIP,
		userAgent: ua,
		cancel:    cancel,
	}
	h.register(client)
	defer func() {
		h.unregister(client)
		_ = conn.Close(websocket.StatusNormalClosure, "bye")
	}()

	// Rehydrate existing player immediately if player_id was provided in query string.
	if playerID != "" {
		if p, err := h.store.GetPlayer(playerID); err == nil {
			if strings.ToUpper(p.MembershipStatus) == "REVOKED" && !isDM {
				_ = h.sendToClient(ctx, client, WSMessage{Event: "MEMBERSHIP_REVOKED", PlayerID: playerID})
				h.sendError(ctx, client, "Tu membresía en esta campaña ha sido revocada por el GM")
				_ = conn.Close(websocket.StatusPolicyViolation, "membership revoked")
				return
			}
			_ = h.store.SetPlayerConnection(playerID, true, clientIP, ua, -1)
			h.BroadcastStateSync()
		}
	}
	h.sendStateSyncTo(ctx, client)

	// Start 15-second PING/PONG heartbeat measuring real RTT latency.
	go h.runHeartbeat(ctx, client)

	for {
		var msg WSMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			break
		}
		h.dispatchMessage(ctx, client, msg)
	}
}

func (h *Hub) runHeartbeat(ctx context.Context, c *wsClient) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			start := time.Now()
			pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.conn.Ping(pingCtx)
			cancel()
			if err != nil {
				c.cancel()
				return
			}
			latency := int(time.Since(start).Milliseconds())
			pid, _ := h.getClientIdentity(c)
			if pid != "" {
				_ = h.store.SetPlayerConnection(pid, true, c.clientIP, c.userAgent, latency)
				h.BroadcastStateSync()
			}
		}
	}
}

func (h *Hub) dispatchMessage(ctx context.Context, c *wsClient, msg WSMessage) {
	switch msg.Event {
	case "JOIN_ROOM":
		var p struct {
			PlayerID   string `json:"player_id"`
			UserID     string `json:"user_id"`
			Username   string `json:"username"`
			Name       string `json:"name"`
			Initiative *int   `json:"initiative"`
			Race       string `json:"race"`
			Color      string `json:"color"`
		}
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			h.sendError(ctx, c, "Payload JOIN_ROOM inválido")
			return
		}
		pid := strings.TrimSpace(p.PlayerID)
		if pid == "" {
			pid = strings.TrimSpace(msg.PlayerID)
		}
		if pid != "" {
			if existing, err := h.store.GetPlayer(pid); err == nil && strings.ToUpper(existing.MembershipStatus) == "REVOKED" {
				_ = h.sendToClient(ctx, c, WSMessage{Event: "MEMBERSHIP_REVOKED", PlayerID: pid})
				h.sendError(ctx, c, "Tu membresía en esta campaña fue revocada")
				return
			}
		}
		initVal := 10
		if p.Initiative != nil {
			initVal = *p.Initiative
		}
		var player store.Player
		var userObj *store.User
		var err error
		if strings.TrimSpace(p.Username) != "" || strings.TrimSpace(p.UserID) != "" {
			var u store.User
			player, u, err = h.store.UpsertPlayerForUser(p.UserID, p.Username, pid, initVal, p.Race, p.Color, c.clientIP, c.userAgent)
			if err == nil {
				userObj = &u
			}
		} else {
			player, err = h.store.UpsertPlayer(pid, p.Name, initVal, p.Race, p.Color, c.clientIP, c.userAgent)
		}
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		h.setClientPlayerID(c, player.ID)
		ackPayload := map[string]any{"player": player}
		if userObj != nil {
			ackPayload["user"] = userObj
		}
		ack, _ := json.Marshal(ackPayload)
		_ = h.sendToClient(ctx, c, WSMessage{Event: "JOIN_ACK", PlayerID: player.ID, Payload: ack})
		_, _ = h.store.AppendActionLog(player.ID, player.Name, "JOIN", fmt.Sprintf("Se unió a la mesa (%s)", player.Name), nil)
		h.BroadcastStateSync()

	case "UPDATE_PROFILE":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		var p struct {
			Name       string `json:"name"`
			Initiative *int   `json:"initiative"`
			Race       string `json:"race"`
			Color      string `json:"color"`
		}
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			h.sendError(ctx, c, "Payload UPDATE_PROFILE inválido")
			return
		}
		targetID, _ := h.getClientIdentity(c)
		if targetID == "" {
			targetID = msg.PlayerID
		}
		if targetID == "" {
			h.sendError(ctx, c, "Jugador no identificado")
			return
		}
		if _, err := h.store.UpdatePlayerProfile(targetID, p.Name, p.Initiative, p.Race, p.Color); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		h.BroadcastStateSync()

	case "ROLL_ACTION":
		var req struct {
			Type         string   `json:"type"`
			DiceNotation string   `json:"dice_notation"`
			StrictYesNo  bool     `json:"strict_yes_no"`
			Question     string   `json:"question"`
			Faces        []string `json:"faces"`
			Options      []string `json:"options"`
			Visibility   string   `json:"visibility"`
			CommandID    string   `json:"command_id"`
			AsDM         bool     `json:"as_dm"`
			PIN          string   `json:"pin"`
		}
		if err := json.Unmarshal(msg.Payload, &req); err != nil {
			h.sendError(ctx, c, "Payload ROLL_ACTION inválido")
			return
		}
		_, currentlyDM := h.getClientIdentity(c)
		if req.AsDM && !currentlyDM {
			if isLocalhostIP(c.clientIP) || (h.dmPIN != "" && req.PIN == h.dmPIN) {
				h.setClientDM(c, true)
			}
		}
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		h.handleRollAction(ctx, c, msg.PlayerID, req.Type, req.DiceNotation, req.StrictYesNo, req.Question, req.Faces, req.Options, req.Visibility, req.CommandID, req.AsDM)

	case "END_TURN":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		h.handleEndTurn(ctx, c, msg.PlayerID)

	case "MOVE_TOKEN":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		var p struct {
			PlayerID string `json:"player_id"`
			TargetX  *int   `json:"target_x"`
			TargetY  *int   `json:"target_y"`
			X        *int   `json:"x"`
			Y        *int   `json:"y"`
		}
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			h.sendError(ctx, c, "Payload MOVE_TOKEN inválido")
			return
		}
		x := 0
		y := 0
		if p.TargetX != nil {
			x = *p.TargetX
		} else if p.X != nil {
			x = *p.X
		}
		if p.TargetY != nil {
			y = *p.TargetY
		} else if p.Y != nil {
			y = *p.Y
		}
		clientPID, isDM := h.getClientIdentity(c)
		targetID := strings.TrimSpace(p.PlayerID)
		if targetID == "" {
			targetID = clientPID
		}
		if !isDM && targetID != clientPID {
			h.sendError(ctx, c, "No puedes mover el token de otro jugador")
			return
		}
		if !isDM && h.isStrictTurnMove() {
			snap, _ := h.BuildSnapshotFor(clientPID, isDM)
			if snap.ActivePlayerID != "" && snap.ActivePlayerID != clientPID {
				h.sendError(ctx, c, "Solo puedes mover tu ficha durante tu turno activo")
				return
			}
		}
		if err := h.store.MoveToken(targetID, x, y); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		movedPayload, _ := json.Marshal(map[string]any{"player_id": targetID, "x": x, "y": y})
		h.broadcastRaw(WSMessage{Event: "TOKEN_MOVED", PlayerID: targetID, Payload: movedPayload})
		h.BroadcastStateSync()

	case "INVENTORY_ACTION":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		var p struct {
			Action      string `json:"action"` // ADD, UPDATE, ADJUST, DELETE
			ItemID      string `json:"item_id"`
			Name        string `json:"name"`
			Quantity    int    `json:"quantity"`
			Delta       int    `json:"delta"`
			Description string `json:"description"`
		}
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			h.sendError(ctx, c, "Payload INVENTORY_ACTION inválido")
			return
		}
		pid, _ := h.getClientIdentity(c)
		if pid == "" {
			pid = msg.PlayerID
		}
		if pid == "" {
			h.sendError(ctx, c, "Jugador no identificado")
			return
		}
		var err error
		switch strings.ToUpper(p.Action) {
		case "ADD", "UPDATE":
			_, err = h.store.UpsertInventoryItem(pid, p.ItemID, p.Name, p.Quantity, p.Description)
		case "ADJUST":
			err = h.store.AdjustInventoryQuantity(pid, p.ItemID, p.Delta)
		case "DELETE":
			err = h.store.DeleteInventoryItem(pid, p.ItemID)
		default:
			err = fmt.Errorf("acción de inventario desconocida: %s", p.Action)
		}
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		h.BroadcastStateSync()

	case "SAVE_NOTES":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		var p struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			h.sendError(ctx, c, "Payload SAVE_NOTES inválido")
			return
		}
		pid, _ := h.getClientIdentity(c)
		if pid == "" {
			pid = msg.PlayerID
		}
		if pid == "" {
			h.sendError(ctx, c, "Jugador no identificado")
			return
		}
		if err := h.store.SavePlayerNotes(pid, p.Content); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		ack, _ := json.Marshal(map[string]any{"saved_at": time.Now().UTC()})
		_ = h.sendToClient(ctx, c, WSMessage{Event: "NOTES_SAVED", PlayerID: pid, Payload: ack})

	case "SAVE_DM_NOTES":
		_, isDM := h.getClientIdentity(c)
		if !isDM {
			h.sendError(ctx, c, "Solo el Dungeon Master puede guardar notas del DM")
			return
		}
		var p struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			return
		}
		_ = h.store.SaveDMNotes(p.Content)

	case "CHAT_SEND":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		h.handleChatSend(ctx, c, msg.PlayerID, msg.Payload)

	case "NOTE_CREATE":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		h.handleNoteCreate(ctx, c, msg.PlayerID, msg.Payload)

	case "NOTE_UPDATE":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		h.handleNoteUpdate(ctx, c, msg.PlayerID, msg.Payload)

	case "NOTE_DELETE":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		h.handleNoteDelete(ctx, c, msg.PlayerID, msg.Payload)

	case "ROLL_TABLE_EXEC":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		h.handleRollTableExec(ctx, c, msg.PlayerID, msg.Payload)

	case "TEMPORARY_MAP_EVENT":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		// Ephemeral canvas pointer, 5ft ruler, AoE template, freehand draw, or soundboard cue (PlanarAlly temporary pattern; no SQLite write).
		pid, _ := h.getClientIdentity(c)
		if pid == "" {
			pid = msg.PlayerID
		}
		h.broadcastRaw(WSMessage{
			Event:    "TEMPORARY_MAP_EVENT",
			PlayerID: pid,
			Payload:  msg.Payload,
		})

	case "UPDATE_TACTICAL_PLAYER":
		if !h.ensureNotRevoked(ctx, c) {
			return
		}
		var req struct {
			TargetPlayerID string          `json:"target_player_id"`
			Conditions     []string        `json:"conditions"`
			AuraRadius     *int            `json:"aura_radius"`
			AuraColor      *string         `json:"aura_color"`
			StatsJSON      json.RawMessage `json:"stats_json"`
		}
		if err := json.Unmarshal(msg.Payload, &req); err != nil {
			h.sendError(ctx, c, "Payload UPDATE_TACTICAL_PLAYER inválido")
			return
		}
		pid, isDM := h.getClientIdentity(c)
		targetID := strings.TrimSpace(req.TargetPlayerID)
		if targetID == "" {
			targetID = pid
		}
		if !isDM && targetID != pid {
			h.sendError(ctx, c, "No puedes modificar el estado táctico de otro jugador")
			return
		}
		if err := h.store.UpdatePlayerTacticalState(targetID, req.Conditions, req.AuraRadius, req.AuraColor, req.StatsJSON); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		h.BroadcastStateSync()

	case "DM_OVERRIDE":
		h.handleDMOverride(ctx, c, msg.Payload)
	}
}

func (h *Hub) broadcastRaw(msg WSMessage) {
	for _, t := range h.snapshotTargets() {
		go func(cl *wsClient, m WSMessage) {
			_ = h.sendToClient(context.Background(), cl, m)
		}(t.client, msg)
	}
}

func (h *Hub) isStrictTurnMove() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.strictTurnMove
}

func (h *Hub) broadcastResultFiltered(rb RollBroadcast) {
	for _, t := range h.snapshotTargets() {
		viewRB, allowed := filterRollForViewer(rb, t.playerID, t.isDM)
		if !allowed {
			continue
		}
		raw, _ := json.Marshal(viewRB)
		msg := WSMessage{
			Event:    "RESULT_BROADCAST",
			PlayerID: rb.PlayerID,
			Payload:  raw,
		}
		go func(cl *wsClient, m WSMessage) {
			_ = h.sendToClient(context.Background(), cl, m)
		}(t.client, msg)
	}
}

func (h *Hub) handleRollAction(
	ctx context.Context,
	c *wsClient,
	fallbackPlayerID, setType, notation string,
	strictYesNo bool,
	question string,
	faces, options []string,
	visibility string,
	commandID string,
	asDM bool,
) {
	clientPID, isDM := h.getClientIdentity(c)
	commandID = strings.TrimSpace(commandID)
	if commandID != "" {
		if cachedRaw, ok := h.store.CheckCommandIdempotency(commandID); ok {
			var cachedRB RollBroadcast
			if err := json.Unmarshal(cachedRaw, &cachedRB); err == nil {
				if viewRB, allowed := filterRollForViewer(cachedRB, clientPID, isDM); allowed {
					b, _ := json.Marshal(viewRB)
					_ = h.sendToClient(ctx, c, WSMessage{Event: "RESULT_BROADCAST", PlayerID: cachedRB.PlayerID, Payload: b})
				}
				return
			}
		}
	}

	snap, _ := h.BuildSnapshotFor(clientPID, isDM)
	pid := clientPID
	if pid == "" {
		pid = fallbackPlayerID
	}
	playerName := "Dungeon Master"
	playerColor := "#f59e0b"
	raceIcon := "dm"
	outOfTurn := false

	if !asDM || !isDM {
		if pid == "" {
			h.sendError(ctx, c, "Debes unirte con tu nombre antes de lanzar")
			return
		}
		p, err := h.store.GetPlayer(pid)
		if err != nil {
			h.sendError(ctx, c, "Jugador no encontrado")
			return
		}
		playerName = p.Name
		playerColor = p.ColorHex
		raceIcon = p.RaceIcon
		if snap.ActivePlayerID != "" && snap.ActivePlayerID != pid {
			if snap.StrictTurnRolls {
				h.sendError(ctx, c, "Espera tu turno para lanzar (modo estricto activado por el DM)")
				return
			}
			outOfTurn = true
		}
	} else {
		pid = "dm"
	}

	vis := store.NormalizeRollVisibility(visibility)
	var summary string
	var detail any
	var isCrit, isFumble, isEdge bool

	switch strings.ToUpper(strings.TrimSpace(setType)) {
	case "DICE":
		res, err := engine.RollDice(notation)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		detail = res
		isCrit = res.IsCritical
		isFumble = res.IsFumble
		summary = fmt.Sprintf("%s => Total: %d", res.Notation, res.Total)
		if isCrit {
			summary += " (¡CRÍTICO NAT 20!)"
		} else if isFumble {
			summary += " (¡PIFIA NAT 1!)"
		}

	case "COIN":
		res, err := engine.FlipCoinDetailed()
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		detail = res
		isEdge = res.IsEdge
		summary = res.DisplayLabel

	case "MAGIC_8_BALL":
		res, err := engine.ShakeMagic8Ball(strictYesNo, strings.TrimSpace(question))
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		detail = res
		if res.Question != "" {
			summary = fmt.Sprintf("«%s» → %s", res.Question, res.Answer)
		} else {
			summary = res.Answer
		}

	case "SPINNER":
		res, err := engine.SpinTop(faces)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		detail = res
		summary = fmt.Sprintf("Peonza (%d caras) → %s", len(res.Faces), res.Label)

	case "WHEEL":
		res, err := engine.SpinWheel(options)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		detail = res
		summary = fmt.Sprintf("Ruleta → %s", res.Option)

	default:
		h.sendError(ctx, c, fmt.Sprintf("Tipo de lanzamiento desconocido: %s", setType))
		return
	}

	campID := h.store.GetActiveCampaignID()
	logEntry, err := h.store.AppendActionLogScoped(
		campID, pid, pid, playerName, strings.ToUpper(setType), summary, vis, commandID, detail,
	)
	if err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}

	rb := RollBroadcast{
		ID:            logEntry.ID,
		Timestamp:     time.Now().UTC(),
		PlayerID:      pid,
		PlayerName:    playerName,
		PlayerColor:   playerColor,
		RaceIcon:      raceIcon,
		SetType:       strings.ToUpper(setType),
		ResultSummary: summary,
		Detail:        detail,
		Visibility:    vis,
		CommandID:     commandID,
		IsCritical:    isCrit,
		IsFumble:      isFumble,
		IsEdge:        isEdge,
		OutOfTurn:     outOfTurn,
	}

	h.store.SaveCommandIdempotency(commandID, pid, "ROLL_ACTION", rb)

	h.mu.Lock()
	h.currentTurnRolls = append(h.currentTurnRolls, rb)
	h.lastResult = &rb
	h.mu.Unlock()

	h.broadcastResultFiltered(rb)
	h.BroadcastStateSync()
}

func (h *Hub) handleChatSend(ctx context.Context, c *wsClient, fallbackID string, payload json.RawMessage) {
	var req struct {
		Body         string   `json:"body"`
		Visibility   string   `json:"visibility"`
		RecipientIDs []string `json:"recipient_ids"`
		CommandID    string   `json:"command_id"`
		AsDM         bool     `json:"as_dm"`
		PIN          string   `json:"pin"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		h.sendError(ctx, c, "Payload CHAT_SEND inválido")
		return
	}
	clientPID, isDM := h.getClientIdentity(c)
	if req.AsDM && !isDM {
		if isLocalhostIP(c.clientIP) || (h.dmPIN != "" && req.PIN == h.dmPIN) {
			h.setClientDM(c, true)
			isDM = true
		}
	}

	if cid := strings.TrimSpace(req.CommandID); cid != "" {
		if _, dup := h.store.CheckCommandIdempotency(cid); dup {
			return
		}
	}

	authorID := clientPID
	if authorID == "" {
		authorID = fallbackID
	}
	authorName := "Dungeon Master"
	authorRole := "GM"
	authorColor := "#f59e0b"

	if !isDM || (!req.AsDM && authorID != "") {
		if authorID == "" {
			h.sendError(ctx, c, "Debes unirte con tu nombre antes de enviar mensajes")
			return
		}
		p, err := h.store.GetPlayer(authorID)
		if err != nil {
			h.sendError(ctx, c, "Jugador no encontrado")
			return
		}
		authorName = p.Name
		authorRole = p.Role
		if authorRole == "" {
			authorRole = "PLAYER"
		}
		authorColor = p.ColorHex
	} else {
		authorID = "dm"
	}

	body := strings.TrimSpace(req.Body)
	lower := strings.ToLower(body)
	if strings.HasPrefix(lower, "/roll ") || strings.HasPrefix(lower, "/r ") {
		expr := strings.TrimSpace(body[strings.Index(body, " ")+1:])
		rollVis := "PUBLIC"
		switch store.NormalizeChatVisibility(req.Visibility) {
		case "GM_WHISPER":
			rollVis = "ROLLER_AND_GM"
		}
		h.handleRollAction(ctx, c, authorID, "DICE", expr, false, "", nil, nil, rollVis, req.CommandID, isDM && req.AsDM)
		return
	}

	campID := h.store.GetActiveCampaignID()
	sessID := h.store.GetActiveCampaignSessionID(campID)
	msgRec, err := h.store.AppendChatMessage(
		campID, sessID, authorID, authorName, authorRole, authorColor,
		body, req.Visibility, req.RecipientIDs, req.CommandID,
	)
	if err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	h.store.SaveCommandIdempotency(req.CommandID, authorID, "CHAT_SEND", msgRec)

	// Deliver private whispers only to authorized recipients
	for _, t := range h.snapshotTargets() {
		visible := msgRec.Visibility == "CAMPAIGN" ||
			(msgRec.Visibility == "GM_WHISPER" && (t.isDM || (t.playerID != "" && t.playerID == msgRec.AuthorID))) ||
			(msgRec.Visibility == "SELECTED_USERS" && (t.isDM || (t.playerID != "" && (t.playerID == msgRec.AuthorID || containsString(msgRec.RecipientIDs, t.playerID)))))
		if !visible {
			continue
		}
		raw, _ := json.Marshal(msgRec)
		wsMsg := WSMessage{Event: "CHAT_MESSAGE", PlayerID: msgRec.AuthorID, Payload: raw}
		go func(cl *wsClient, m WSMessage) {
			_ = h.sendToClient(context.Background(), cl, m)
		}(t.client, wsMsg)
	}
	h.BroadcastStateSync()
}

func containsString(list []string, target string) bool {
	for _, s := range list {
		if s == target {
			return true
		}
	}
	return false
}

func (h *Hub) resolveActor(c *wsClient, fallbackID string, asDM bool, pin string) (actorID, actorName string, isDM bool, err error) {
	clientPID, currentlyDM := h.getClientIdentity(c)
	if asDM && !currentlyDM {
		if isLocalhostIP(c.clientIP) || (h.dmPIN != "" && pin == h.dmPIN) {
			h.setClientDM(c, true)
			currentlyDM = true
		}
	}
	if currentlyDM && (asDM || clientPID == "") {
		return "dm", "Dungeon Master", true, nil
	}
	pid := clientPID
	if pid == "" {
		pid = fallbackID
	}
	if pid == "" {
		return "", "", currentlyDM, fmt.Errorf("jugador no identificado")
	}
	p, getErr := h.store.GetPlayer(pid)
	if getErr != nil {
		return "", "", currentlyDM, fmt.Errorf("jugador no encontrado")
	}
	return p.ID, p.Name, currentlyDM, nil
}

func (h *Hub) handleNoteCreate(ctx context.Context, c *wsClient, fallbackID string, payload json.RawMessage) {
	var req struct {
		Title        string   `json:"title"`
		Body         string   `json:"body"`
		Category     string   `json:"category"`
		Visibility   string   `json:"visibility"`
		RecipientIDs []string `json:"recipient_ids"`
		AllowEdit    bool     `json:"allow_edit"`
		AsDM         bool     `json:"as_dm"`
		PIN          string   `json:"pin"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		h.sendError(ctx, c, "Payload NOTE_CREATE inválido")
		return
	}
	actorID, actorName, _, err := h.resolveActor(c, fallbackID, req.AsDM, req.PIN)
	if err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	campID := h.store.GetActiveCampaignID()
	if _, err := h.store.CreateCampaignNote(
		campID, actorID, actorName, req.Title, req.Body, req.Category, req.Visibility, req.RecipientIDs, req.AllowEdit,
	); err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	h.BroadcastStateSync()
}

func (h *Hub) handleNoteUpdate(ctx context.Context, c *wsClient, fallbackID string, payload json.RawMessage) {
	var req struct {
		NoteID          string   `json:"note_id"`
		ExpectedVersion int      `json:"expected_version"`
		Title           string   `json:"title"`
		Body            string   `json:"body"`
		Category        string   `json:"category"`
		Visibility      string   `json:"visibility"`
		RecipientIDs    []string `json:"recipient_ids"`
		AllowEdit       *bool    `json:"allow_edit"`
		AsDM            bool     `json:"as_dm"`
		PIN             string   `json:"pin"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		h.sendError(ctx, c, "Payload NOTE_UPDATE inválido")
		return
	}
	actorID, _, isDM, err := h.resolveActor(c, fallbackID, req.AsDM, req.PIN)
	if err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	if _, err := h.store.UpdateCampaignNote(
		req.NoteID, actorID, isDM, req.ExpectedVersion, req.Title, req.Body, req.Category, req.Visibility, req.RecipientIDs, req.AllowEdit,
	); err != nil {
		if errors.Is(err, store.ErrVersionConflict) {
			raw, _ := json.Marshal(map[string]any{"note_id": req.NoteID, "message": err.Error()})
			_ = h.sendToClient(ctx, c, WSMessage{Event: "NOTE_CONFLICT", Payload: raw})
		}
		h.sendError(ctx, c, err.Error())
		return
	}
	h.BroadcastStateSync()
}

func (h *Hub) handleNoteDelete(ctx context.Context, c *wsClient, fallbackID string, payload json.RawMessage) {
	var req struct {
		NoteID string `json:"note_id"`
		AsDM   bool   `json:"as_dm"`
		PIN    string `json:"pin"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		h.sendError(ctx, c, "Payload NOTE_DELETE inválido")
		return
	}
	actorID, _, isDM, err := h.resolveActor(c, fallbackID, req.AsDM, req.PIN)
	if err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	if err := h.store.DeleteCampaignNote(req.NoteID, actorID, isDM); err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	h.BroadcastStateSync()
}

func (h *Hub) handleRollTableExec(ctx context.Context, c *wsClient, fallbackID string, payload json.RawMessage) {
	var req struct {
		TableID    string `json:"table_id"`
		Visibility string `json:"visibility"`
		AsDM       bool   `json:"as_dm"`
		PIN        string `json:"pin"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		h.sendError(ctx, c, "Payload ROLL_TABLE_EXEC inválido")
		return
	}
	actorID, actorName, _, err := h.resolveActor(c, fallbackID, req.AsDM, req.PIN)
	if err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	res, err := h.store.ExecuteRollTable(req.TableID)
	if err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	vis := store.NormalizeRollVisibility(req.Visibility)
	campID := h.store.GetActiveCampaignID()
	summary := fmt.Sprintf("Tabla [%s] (%d/%d) → %s", res.TableName, res.Roll, res.MaxWeight, res.Entry.Label)
	entry, _ := h.store.AppendActionLogScoped(campID, actorID, actorID, actorName, "ROLL_TABLE", summary, vis, "", res)

	rb := RollBroadcast{
		ID:            entry.ID,
		Timestamp:     time.Now().UTC(),
		PlayerID:      actorID,
		PlayerName:    actorName,
		PlayerColor:   "#f59e0b",
		RaceIcon:      "dm",
		SetType:       "WHEEL",
		ResultSummary: summary,
		Detail:        res,
		Visibility:    vis,
	}
	h.mu.Lock()
	h.currentTurnRolls = append(h.currentTurnRolls, rb)
	h.lastResult = &rb
	h.mu.Unlock()

	h.broadcastResultFiltered(rb)
	h.BroadcastStateSync()
}

func (h *Hub) handleEndTurn(ctx context.Context, c *wsClient, fallbackID string) {
	clientPID, isDM := h.getClientIdentity(c)
	snap, err := h.BuildSnapshotFor(clientPID, isDM)
	if err != nil || len(snap.Players) == 0 {
		return
	}
	pid := clientPID
	if pid == "" {
		pid = fallbackID
	}
	if !isDM && snap.ActivePlayerID != pid {
		h.sendError(ctx, c, "Solo el jugador en turno actual puede pasar el turno")
		return
	}

	nextIdx := engine.NextTurnIndex(snap.CurrentTurnIndex, len(snap.Players))
	if err := h.store.UpdateCurrentTurnIndex(nextIdx); err != nil {
		h.sendError(ctx, c, err.Error())
		return
	}
	if nextIdx == 0 && len(snap.Players) > 0 {
		_ = h.store.IncrementRound()
	}

	prevName := snap.Players[snap.CurrentTurnIndex].Name
	nextName := snap.Players[nextIdx].Name

	h.mu.Lock()
	h.currentTurnRolls = nil
	h.mu.Unlock()

	_, _ = h.store.AppendActionLog(
		snap.Players[snap.CurrentTurnIndex].ID,
		prevName,
		"TURN",
		fmt.Sprintf("Pasó el turno → Ahora es el turno de %s", nextName),
		nil,
	)
	h.BroadcastStateSync()
}

func (h *Hub) handleDMOverride(ctx context.Context, c *wsClient, payload json.RawMessage) {
	var cmd struct {
		Action          string                 `json:"action"`
		PIN             string                 `json:"pin"`
		TargetPlayerID  string                 `json:"target_player_id"`
		Value           int                    `json:"value"`
		PlayerIDs       []string               `json:"player_ids"`
		MapEnabled      *bool                  `json:"map_enabled"`
		MapRows         *int                   `json:"map_rows"`
		MapCols         *int                   `json:"map_cols"`
		MapGridColor    *string                `json:"map_grid_color"`
		MapGridOpacity  *float64               `json:"map_grid_opacity"`
		TargetX         int                    `json:"target_x"`
		TargetY         int                    `json:"target_y"`
		Hidden          bool                   `json:"hidden"`
		StrictTurnRolls *bool                  `json:"strict_turn_rolls"`
		StrictTurnMove  *bool                  `json:"strict_turn_move"`
		EntityID        string                 `json:"entity_id"`
		EntityKind      string                 `json:"entity_kind"`
		EntityName      string                 `json:"entity_name"`
		EntitySize      int                    `json:"entity_size"`
		EntityColor     string                 `json:"entity_color"`
		EntityHPCurrent *int                   `json:"entity_hp_current"`
		EntityHPMax     *int                   `json:"entity_hp_max"`
		EntityNote      *string                `json:"entity_note"`
		EntityHidden    *bool                  `json:"entity_hidden"`
		CampaignID      string                 `json:"campaign_id"`
		CampaignName    string                 `json:"campaign_name"`
		CampaignDesc    string                 `json:"campaign_desc"`
		CampaignSystem  string                 `json:"campaign_system"`
		Archived        bool                   `json:"archived"`
		SessionID       string                 `json:"session_id"`
		SessionTitle    string                 `json:"session_title"`
		SessionStatus   string                 `json:"session_status"`
		Role            string                 `json:"role"`
		MembershipStat  string                 `json:"membership_status"`
		MessageID       string                 `json:"message_id"`
		TableID         string                 `json:"table_id"`
		TableName       string                 `json:"table_name"`
		TableDesc       string                 `json:"table_desc"`
		TableEntries    []store.RollTableEntry `json:"table_entries"`
		FogEnabled      *bool                  `json:"fog_enabled"`
		FogRevealed     []string               `json:"fog_revealed"`
		SceneCards      []store.SceneCard      `json:"scene_cards"`
		SceneID         string                 `json:"scene_id"`
		SceneName       string                 `json:"scene_name"`
		Conditions      []string               `json:"conditions"`
		AuraRadius      *int                   `json:"aura_radius"`
		AuraColor       *string                `json:"aura_color"`
		MobName         string                 `json:"mob_name"`
		MobCount        int                    `json:"mob_count"`
		MobAtkBonus     int                    `json:"mob_atk_bonus"`
		MobTargetAC     int                    `json:"mob_target_ac"`
		MobDmgNotation  string                 `json:"mob_dmg_notation"`
		MobVisibility   string                 `json:"mob_visibility"`
		UserID          string                 `json:"user_id"`
		CharacterID     string                 `json:"character_id"`
	}
	if err := json.Unmarshal(payload, &cmd); err != nil {
		h.sendError(ctx, c, "Payload DM_OVERRIDE inválido")
		return
	}

	_, isDM := h.getClientIdentity(c)
	if !isDM {
		if isLocalhostIP(c.clientIP) || (h.dmPIN != "" && cmd.PIN == h.dmPIN) {
			h.setClientDM(c, true)
		} else {
			h.sendError(ctx, c, "Acceso denegado: requiere permisos del Dungeon Master")
			return
		}
	}

	campID := h.store.GetActiveCampaignID()

	switch strings.ToUpper(cmd.Action) {
	case "SET_INITIATIVE":
		if err := h.store.SetPlayerInitiative(cmd.TargetPlayerID, cmd.Value); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_, _ = h.store.AppendActionLog("dm", "Dungeon Master", "DM_OVERRIDE", fmt.Sprintf("Actualizó iniciativa a %d", cmd.Value), nil)

	case "ASSIGN_CHARACTER":
		uid := strings.TrimSpace(cmd.UserID)
		if uid == "" && cmd.TargetPlayerID != "" {
			if pl, err := h.store.GetPlayer(cmd.TargetPlayerID); err == nil {
				uid = pl.UserID
			}
		}
		if err := h.store.AssignCharacter(uid, cmd.TargetPlayerID, cmd.CharacterID); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "ASSIGN_CHARACTER", fmt.Sprintf("Asignó personaje %s al jugador %s", cmd.CharacterID, cmd.TargetPlayerID))

	case "REORDER_PLAYERS":
		if err := h.store.ReorderPlayers(cmd.PlayerIDs); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "NEXT_TURN":
		snap, err := h.BuildSnapshot()
		if err == nil && len(snap.Players) > 0 {
			nextIdx := engine.NextTurnIndex(snap.CurrentTurnIndex, len(snap.Players))
			_ = h.store.UpdateCurrentTurnIndex(nextIdx)
			if nextIdx == 0 {
				_ = h.store.IncrementRound()
			}
			h.mu.Lock()
			h.currentTurnRolls = nil
			h.mu.Unlock()
			_, _ = h.store.AppendActionLog("dm", "Dungeon Master", "TURN", fmt.Sprintf("Forzó avance de turno → %s", snap.Players[nextIdx].Name), nil)
		}

	case "PREV_TURN":
		snap, err := h.BuildSnapshot()
		if err == nil && len(snap.Players) > 0 {
			prevIdx := engine.PrevTurnIndex(snap.CurrentTurnIndex, len(snap.Players))
			_ = h.store.UpdateCurrentTurnIndex(prevIdx)
			h.mu.Lock()
			h.currentTurnRolls = nil
			h.mu.Unlock()
			_, _ = h.store.AppendActionLog("dm", "Dungeon Master", "TURN", fmt.Sprintf("Retrocedió turno → %s", snap.Players[prevIdx].Name), nil)
		}

	case "SET_ACTIVE_PLAYER":
		players, err := h.store.ListPlayersOrdered()
		if err == nil {
			for i, p := range players {
				if p.ID == cmd.TargetPlayerID {
					_ = h.store.UpdateCurrentTurnIndex(i)
					h.mu.Lock()
					h.currentTurnRolls = nil
					h.mu.Unlock()
					_, _ = h.store.AppendActionLog("dm", "Dungeon Master", "TURN", fmt.Sprintf("Asignó turno directo a %s", p.Name), nil)
					break
				}
			}
		}

	case "KICK_PLAYER":
		p, err := h.store.GetPlayer(cmd.TargetPlayerID)
		if err == nil {
			_ = h.store.DeletePlayer(cmd.TargetPlayerID)
			for _, t := range h.snapshotTargets() {
				if t.playerID == cmd.TargetPlayerID {
					_ = h.sendToClient(ctx, t.client, WSMessage{Event: "KICKED", PlayerID: cmd.TargetPlayerID})
				}
			}
			_, _ = h.store.AppendActionLog("dm", "Dungeon Master", "DM_OVERRIDE", fmt.Sprintf("Expulsó a %s de la mesa", p.Name), nil)
			_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "KICK_PLAYER", fmt.Sprintf("Expulsó a %s", p.Name))
		}

	case "SET_MEMBERSHIP_STATUS":
		if err := h.store.SetPlayerMembership(cmd.TargetPlayerID, cmd.Role, cmd.MembershipStat); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		p, _ := h.store.GetPlayer(cmd.TargetPlayerID)
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "MEMBERSHIP_UPDATE", fmt.Sprintf("Membresía de %s → rol=%s estado=%s", p.Name, p.Role, p.MembershipStatus))
		if strings.ToUpper(cmd.MembershipStat) == "REVOKED" {
			for _, t := range h.snapshotTargets() {
				if t.playerID == cmd.TargetPlayerID && !t.isDM {
					_ = h.sendToClient(ctx, t.client, WSMessage{Event: "MEMBERSHIP_REVOKED", PlayerID: cmd.TargetPlayerID})
					h.sendError(ctx, t.client, "Tu membresía ha sido revocada por el GM")
					t.client.cancel()
					_ = t.client.conn.Close(websocket.StatusPolicyViolation, "membership revoked")
				}
			}
		}

	case "UPDATE_MAP_CONFIG":
		sess, err := h.store.GetSession()
		if err != nil {
			return
		}
		enabled := sess.MapEnabled
		rows := sess.MapRows
		cols := sess.MapCols
		color := sess.MapGridColor
		opacity := sess.MapGridOpacity
		if cmd.MapEnabled != nil {
			enabled = *cmd.MapEnabled
		}
		if cmd.MapRows != nil {
			rows = *cmd.MapRows
		}
		if cmd.MapCols != nil {
			cols = *cmd.MapCols
		}
		if cmd.MapGridColor != nil {
			color = *cmd.MapGridColor
		}
		if cmd.MapGridOpacity != nil {
			opacity = *cmd.MapGridOpacity
		}
		if _, err := h.store.UpdateMapConfig(enabled, rows, cols, color, opacity); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "CLEAR_MAP_IMAGE":
		_ = h.store.SetMapImagePath("")

	case "MOVE_ANY_TOKEN":
		if err := h.store.MoveToken(cmd.TargetPlayerID, cmd.TargetX, cmd.TargetY); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		movedPayload, _ := json.Marshal(map[string]any{"player_id": cmd.TargetPlayerID, "x": cmd.TargetX, "y": cmd.TargetY})
		h.broadcastRaw(WSMessage{Event: "TOKEN_MOVED", PlayerID: cmd.TargetPlayerID, Payload: movedPayload})

	case "TOGGLE_TOKEN_VISIBILITY":
		_ = h.store.ToggleTokenVisibility(cmd.TargetPlayerID, cmd.Hidden)

	case "RESET_TOKENS":
		_ = h.store.ResetTokens()

	case "SET_TURN_RULES":
		h.mu.Lock()
		if cmd.StrictTurnRolls != nil {
			h.strictTurnRolls = *cmd.StrictTurnRolls
		}
		if cmd.StrictTurnMove != nil {
			h.strictTurnMove = *cmd.StrictTurnMove
		}
		h.mu.Unlock()

	case "ADD_MAP_ENTITY":
		hpCur := 0
		hpMax := 0
		if cmd.EntityHPCurrent != nil {
			hpCur = *cmd.EntityHPCurrent
		}
		if cmd.EntityHPMax != nil {
			hpMax = *cmd.EntityHPMax
		}
		note := ""
		if cmd.EntityNote != nil {
			note = *cmd.EntityNote
		}
		isHidden := false
		if cmd.EntityHidden != nil {
			isHidden = *cmd.EntityHidden
		}
		ent, err := h.store.AddMapEntity(
			cmd.EntityKind, cmd.EntityName,
			cmd.TargetX, cmd.TargetY, cmd.EntitySize,
			cmd.EntityColor, hpCur, hpMax, note, isHidden,
		)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		if !ent.IsHidden {
			_, _ = h.store.AppendActionLog("dm", "Dungeon Master", "MAP_ENTITY", fmt.Sprintf("Colocó %s (%s) en (%d, %d)", ent.Name, ent.Kind, ent.X+1, ent.Y+1), nil)
		}

	case "MOVE_MAP_ENTITY":
		if err := h.store.MoveMapEntity(cmd.EntityID, cmd.TargetX, cmd.TargetY); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "UPDATE_MAP_ENTITY":
		if err := h.store.UpdateMapEntity(cmd.EntityID, cmd.EntityName, cmd.EntityHPCurrent, cmd.EntityHPMax, cmd.EntityNote, cmd.EntityHidden); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "DELETE_MAP_ENTITY":
		if err := h.store.DeleteMapEntity(cmd.EntityID); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "CLEAR_MAP_ENTITIES":
		if err := h.store.ClearMapEntities(); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "CREATE_CAMPAIGN":
		cObj, err := h.store.CreateCampaign(cmd.CampaignName, cmd.CampaignDesc, cmd.CampaignSystem, true)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(cObj.ID, "dm", "Dungeon Master", "CAMPAIGN_CREATE", fmt.Sprintf("Creó y activó campaña %q", cObj.Name))

	case "UPDATE_CAMPAIGN":
		targetCamp := cmd.CampaignID
		if targetCamp == "" {
			targetCamp = campID
		}
		if err := h.store.UpdateCampaign(targetCamp, cmd.CampaignName, cmd.CampaignDesc, cmd.CampaignSystem); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(targetCamp, "dm", "Dungeon Master", "CAMPAIGN_UPDATE", fmt.Sprintf("Actualizó datos de campaña %q", cmd.CampaignName))

	case "ARCHIVE_CAMPAIGN":
		if err := h.store.ArchiveCampaign(cmd.CampaignID, cmd.Archived); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "CAMPAIGN_ARCHIVE", fmt.Sprintf("Cambió estado de archivo (%v) en %s", cmd.Archived, cmd.CampaignID))

	case "SWITCH_CAMPAIGN":
		if err := h.store.SwitchCampaign(cmd.CampaignID); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(cmd.CampaignID, "dm", "Dungeon Master", "CAMPAIGN_SWITCH", "Cambió campaña activa en la mesa")

	case "START_CAMPAIGN_SESSION":
		cs, err := h.store.StartCampaignSession(campID, cmd.SessionTitle)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "SESSION_START", fmt.Sprintf("Inició sesión %q", cs.Title))

	case "PAUSE_CAMPAIGN_SESSION":
		sid := cmd.SessionID
		if sid == "" {
			sid = h.store.GetActiveCampaignSessionID(campID)
		}
		if err := h.store.UpdateCampaignSessionStatus(sid, "PAUSED"); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "SESSION_PAUSE", fmt.Sprintf("Pausó sesión %s", sid))

	case "CLOSE_CAMPAIGN_SESSION":
		sid := cmd.SessionID
		if sid == "" {
			sid = h.store.GetActiveCampaignSessionID(campID)
		}
		if err := h.store.UpdateCampaignSessionStatus(sid, "CLOSED"); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "SESSION_CLOSE", fmt.Sprintf("Cerró sesión %s (recursos conservados)", sid))

	case "DELETE_CHAT_MESSAGE":
		if err := h.store.DeleteChatMessage(cmd.MessageID); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "CHAT_MODERATE", fmt.Sprintf("Moderó mensaje %s", cmd.MessageID))

	case "CREATE_ROLL_TABLE":
		rt, err := h.store.CreateRollTable(campID, cmd.TableName, cmd.TableDesc, cmd.TableEntries)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "ROLL_TABLE_CREATE", fmt.Sprintf("Creó tabla aleatoria %q", rt.Name))

	case "DELETE_ROLL_TABLE":
		if err := h.store.DeleteRollTable(cmd.TableID); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "UPDATE_FOG":
		sess, err := h.store.GetSession()
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		fogEn := sess.FogEnabled
		if cmd.FogEnabled != nil {
			fogEn = *cmd.FogEnabled
		}
		revealed := cmd.FogRevealed
		if revealed == nil {
			revealed = sess.FogRevealed
		}
		if err := h.store.UpdateFogState(fogEn, revealed); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "SET_SCENE_CARDS":
		if err := h.store.SetSceneCards(cmd.SceneCards); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "SAVE_SCENE":
		sc, err := h.store.SaveCurrentScene(campID, cmd.SceneName)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "SCENE_SAVE", fmt.Sprintf("Guardó escena táctica %q (%dx%d)", sc.Name, sc.MapCols, sc.MapRows))

	case "ACTIVATE_SCENE":
		if err := h.store.ActivateMapScene(cmd.SceneID); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_ = h.store.AppendAuditEvent(campID, "dm", "Dungeon Master", "SCENE_ACTIVATE", fmt.Sprintf("Cambió escena activa a %s", cmd.SceneID))

	case "DELETE_SCENE":
		if err := h.store.DeleteMapScene(cmd.SceneID); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "UPDATE_ENTITY_TACTICAL":
		if err := h.store.UpdateMapEntityTactical(cmd.EntityID, cmd.Conditions, cmd.AuraRadius, cmd.AuraColor); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}

	case "MOB_ROLL":
		count := cmd.MobCount
		if count < 1 {
			count = 1
		} else if count > 50 {
			count = 50
		}
		mobName := strings.TrimSpace(cmd.MobName)
		if mobName == "" {
			mobName = "Horda"
		}
		dmgExpr := strings.TrimSpace(cmd.MobDmgNotation)
		if dmgExpr == "" {
			dmgExpr = "1d6+2"
		}
		type mobHitDetail struct {
			AttackRoll int  `json:"d20"`
			TotalAtk   int  `json:"total_atk"`
			Hit        bool `json:"hit"`
			Crit       bool `json:"crit"`
			Damage     int  `json:"damage"`
		}
		attacks := make([]mobHitDetail, 0, count)
		hits := 0
		crits := 0
		totalDmg := 0
		for i := 0; i < count; i++ {
			d20, dErr := engine.CryptoRandInt(1, 20)
			if dErr != nil {
				h.sendError(ctx, c, dErr.Error())
				return
			}
			totalAtk := d20 + cmd.MobAtkBonus
			isCrit := d20 == 20
			isHit := isCrit || (d20 != 1 && totalAtk >= cmd.MobTargetAC)
			dmg := 0
			if isHit {
				hits++
				dRes, dErr := engine.RollDice(dmgExpr)
				if dErr != nil {
					h.sendError(ctx, c, dErr.Error())
					return
				}
				dmg = dRes.Total
				if isCrit {
					crits++
					// Roll extra critical damage dice (subtotal of dice without flat modifier repeated)
					dmg += dRes.Subtotal
				}
				if dmg < 0 {
					dmg = 0
				}
				totalDmg += dmg
			}
			attacks = append(attacks, mobHitDetail{
				AttackRoll: d20,
				TotalAtk:   totalAtk,
				Hit:        isHit,
				Crit:       isCrit,
				Damage:     dmg,
			})
		}

		vis := store.NormalizeRollVisibility(cmd.MobVisibility)
		summary := fmt.Sprintf("Horda %s (%dx vs CA %d): %d impactos (%d crít.), Daño total: %d", mobName, count, cmd.MobTargetAC, hits, crits, totalDmg)
		detail := map[string]any{
			"mob_name":        mobName,
			"count":           count,
			"attack_bonus":    cmd.MobAtkBonus,
			"target_ac":       cmd.MobTargetAC,
			"damage_notation": dmgExpr,
			"hits":            hits,
			"crits":           crits,
			"total_damage":    totalDmg,
			"attacks":         attacks,
		}
		entry, _ := h.store.AppendActionLogScoped(campID, "dm", "dm", "Dungeon Master", "MOB_ROLL", summary, vis, "", detail)
		rb := RollBroadcast{
			ID:            entry.ID,
			Timestamp:     time.Now().UTC(),
			PlayerID:      "dm",
			PlayerName:    "Dungeon Master",
			PlayerColor:   "#f59e0b",
			RaceIcon:      "dm",
			SetType:       "DICE",
			ResultSummary: summary,
			Detail:        detail,
			Visibility:    vis,
			IsCritical:    crits > 0,
		}
		h.mu.Lock()
		h.currentTurnRolls = append(h.currentTurnRolls, rb)
		h.lastResult = &rb
		h.mu.Unlock()
		h.broadcastResultFiltered(rb)
	}

	h.BroadcastStateSync()
}

func extractClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func isLocalhostIP(ipStr string) bool {
	ipStr = strings.TrimSpace(ipStr)
	if ipStr == "127.0.0.1" || ipStr == "::1" || ipStr == "localhost" {
		return true
	}
	ip := net.ParseIP(ipStr)
	return ip != nil && ip.IsLoopback()
}
