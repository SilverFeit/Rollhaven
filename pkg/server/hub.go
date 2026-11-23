package server

import (
	"context"
	"encoding/json"
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

// RollBroadcast represents a single roll/decision result transmitted live to all connected screens.
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
	IsCritical    bool      `json:"is_critical,omitempty"`
	IsFumble      bool      `json:"is_fumble,omitempty"`
	IsEdge        bool      `json:"is_edge,omitempty"`
	OutOfTurn     bool      `json:"out_of_turn,omitempty"`
}

// StateSnapshot is pushed via STATE_SYNC whenever players, turns, rolls, or map settings change.
type StateSnapshot struct {
	Session          store.Session          `json:"session"`
	Players          []store.Player         `json:"players"`
	CurrentTurnIndex int                    `json:"current_turn_index"`
	ActivePlayerID   string                 `json:"active_player_id"`
	CurrentTurnRolls []RollBroadcast        `json:"current_turn_rolls"`
	LastResult       *RollBroadcast         `json:"last_result,omitempty"`
	ActionLog        []store.ActionLogEntry `json:"action_log"`
	StrictTurnRolls  bool                   `json:"strict_turn_rolls"`
	StrictTurnMove   bool                   `json:"strict_turn_move"`
	LanIP            string                 `json:"lan_ip"`
	Port             int                    `json:"port"`
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

// Hub coordinates WebSocket clients, turn state, live turn rolls, and broadcasts.
type Hub struct {
	store *store.Store
	lanIP string
	port  int
	dmPIN string

	mu               sync.RWMutex
	closed           bool
	clients          map[*wsClient]struct{}
	currentTurnRolls []RollBroadcast
	lastResult       *RollBroadcast
	strictTurnRolls  bool
	strictTurnMove   bool
}

// Close marks the hub closed and terminates any active WebSocket clients cleanly.
func (h *Hub) Close() {
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

func (h *Hub) broadcast(msg any) {
	h.mu.RLock()
	targets := make([]*wsClient, 0, len(h.clients))
	for c := range h.clients {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	for _, c := range targets {
		go func(client *wsClient) {
			if err := h.sendToClient(context.Background(), client, msg); err != nil {
				// Client write errors will trigger disconnect cleanup in read loop.
				_ = err
			}
		}(c)
	}
}

// BuildSnapshot constructs a consistent STATE_SYNC payload from SQLite and hub memory.
func (h *Hub) BuildSnapshot() (StateSnapshot, error) {
	sess, err := h.store.GetSession()
	if err != nil {
		return StateSnapshot{}, err
	}
	players, err := h.store.ListPlayersOrdered()
	if err != nil {
		return StateSnapshot{}, err
	}
	logs, err := h.store.ListActionLog(60)
	if err != nil {
		return StateSnapshot{}, err
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
	rollsCopy := make([]RollBroadcast, len(h.currentTurnRolls))
	copy(rollsCopy, h.currentTurnRolls)
	var lastCopy *RollBroadcast
	if h.lastResult != nil {
		cp := *h.lastResult
		lastCopy = &cp
	}
	strictRolls := h.strictTurnRolls
	strictMove := h.strictTurnMove
	h.mu.RUnlock()

	return StateSnapshot{
		Session:          sess,
		Players:          players,
		CurrentTurnIndex: turnIdx,
		ActivePlayerID:   activeID,
		CurrentTurnRolls: rollsCopy,
		LastResult:       lastCopy,
		ActionLog:        logs,
		StrictTurnRolls:  strictRolls,
		StrictTurnMove:   strictMove,
		LanIP:            h.lanIP,
		Port:             h.port,
	}, nil
}

// BroadcastStateSync pushes the current global state to every connected WebSocket client.
func (h *Hub) BroadcastStateSync() {
	h.mu.RLock()
	closed := h.closed
	h.mu.RUnlock()
	if closed {
		return
	}
	snap, err := h.BuildSnapshot()
	if err != nil {
		if !strings.Contains(err.Error(), "database is closed") {
			log.Printf("build state snapshot error: %v", err)
		}
		return
	}
	raw, _ := json.Marshal(snap)
	h.broadcast(WSMessage{
		Event:   "STATE_SYNC",
		Payload: raw,
	})
}

func (h *Hub) sendStateSyncTo(ctx context.Context, c *wsClient) {
	snap, err := h.BuildSnapshot()
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
		if _, err := h.store.GetPlayer(playerID); err == nil {
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
			if c.playerID != "" {
				_ = h.store.SetPlayerConnection(c.playerID, true, c.clientIP, c.userAgent, latency)
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
			Name       string `json:"name"`
			Initiative int    `json:"initiative"`
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
		player, err := h.store.UpsertPlayer(pid, p.Name, p.Initiative, p.Race, p.Color, c.clientIP, c.userAgent)
		if err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		c.playerID = player.ID
		ack, _ := json.Marshal(map[string]any{"player": player})
		_ = h.sendToClient(ctx, c, WSMessage{Event: "JOIN_ACK", PlayerID: player.ID, Payload: ack})
		_, _ = h.store.AppendActionLog(player.ID, player.Name, "JOIN", fmt.Sprintf("Se unió con iniciativa %d", player.Initiative), nil)
		h.BroadcastStateSync()

	case "UPDATE_PROFILE":
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
		targetID := c.playerID
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
			AsDM         bool     `json:"as_dm"`
		}
		if err := json.Unmarshal(msg.Payload, &req); err != nil {
			h.sendError(ctx, c, "Payload ROLL_ACTION inválido")
			return
		}
		h.handleRollAction(ctx, c, msg.PlayerID, req.Type, req.DiceNotation, req.StrictYesNo, req.Question, req.Faces, req.Options, req.AsDM)

	case "END_TURN":
		h.handleEndTurn(ctx, c, msg.PlayerID)

	case "MOVE_TOKEN":
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
		targetID := strings.TrimSpace(p.PlayerID)
		if targetID == "" {
			targetID = c.playerID
		}
		if !c.isDM && targetID != c.playerID {
			h.sendError(ctx, c, "No puedes mover el token de otro jugador")
			return
		}
		if !c.isDM && h.isStrictTurnMove() {
			snap, _ := h.BuildSnapshot()
			if snap.ActivePlayerID != "" && snap.ActivePlayerID != c.playerID {
				h.sendError(ctx, c, "Solo puedes mover tu ficha durante tu turno activo")
				return
			}
		}
		if err := h.store.MoveToken(targetID, x, y); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		movedPayload, _ := json.Marshal(map[string]any{"player_id": targetID, "x": x, "y": y})
		h.broadcast(WSMessage{Event: "TOKEN_MOVED", PlayerID: targetID, Payload: movedPayload})
		h.BroadcastStateSync()

	case "INVENTORY_ACTION":
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
		pid := c.playerID
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
		var p struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			h.sendError(ctx, c, "Payload SAVE_NOTES inválido")
			return
		}
		pid := c.playerID
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
		if !c.isDM {
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

	case "DM_OVERRIDE":
		h.handleDMOverride(ctx, c, msg.Payload)
	}
}

func (h *Hub) isStrictTurnMove() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.strictTurnMove
}

func (h *Hub) handleRollAction(
	ctx context.Context,
	c *wsClient,
	fallbackPlayerID, setType, notation string,
	strictYesNo bool,
	question string,
	faces, options []string,
	asDM bool,
) {
	snap, _ := h.BuildSnapshot()
	pid := c.playerID
	if pid == "" {
		pid = fallbackPlayerID
	}
	playerName := "Dungeon Master"
	playerColor := "#f59e0b"
	raceIcon := "dm"
	outOfTurn := false

	if !asDM || !c.isDM {
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

	logEntry, err := h.store.AppendActionLog(pid, playerName, strings.ToUpper(setType), summary, detail)
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
		IsCritical:    isCrit,
		IsFumble:      isFumble,
		IsEdge:        isEdge,
		OutOfTurn:     outOfTurn,
	}

	h.mu.Lock()
	h.currentTurnRolls = append(h.currentTurnRolls, rb)
	h.lastResult = &rb
	h.mu.Unlock()

	rawRB, _ := json.Marshal(rb)
	h.broadcast(WSMessage{
		Event:    "RESULT_BROADCAST",
		PlayerID: pid,
		Payload:  rawRB,
	})
	h.BroadcastStateSync()
}

func (h *Hub) handleEndTurn(ctx context.Context, c *wsClient, fallbackID string) {
	snap, err := h.BuildSnapshot()
	if err != nil || len(snap.Players) == 0 {
		return
	}
	pid := c.playerID
	if pid == "" {
		pid = fallbackID
	}
	if !c.isDM && snap.ActivePlayerID != pid {
		h.sendError(ctx, c, "Solo el jugador en turno actual puede pasar el turno")
		return
	}

	nextIdx := engine.NextTurnIndex(snap.CurrentTurnIndex, len(snap.Players))
	if err := h.store.UpdateCurrentTurnIndex(nextIdx); err != nil {
		h.sendError(ctx, c, err.Error())
		return
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
		Action          string   `json:"action"`
		PIN             string   `json:"pin"`
		TargetPlayerID  string   `json:"target_player_id"`
		Value           int      `json:"value"`
		PlayerIDs       []string `json:"player_ids"`
		MapEnabled      *bool    `json:"map_enabled"`
		MapRows         *int     `json:"map_rows"`
		MapCols         *int     `json:"map_cols"`
		MapGridColor    *string  `json:"map_grid_color"`
		MapGridOpacity  *float64 `json:"map_grid_opacity"`
		TargetX         int      `json:"target_x"`
		TargetY         int      `json:"target_y"`
		Hidden          bool     `json:"hidden"`
		StrictTurnRolls *bool    `json:"strict_turn_rolls"`
		StrictTurnMove  *bool    `json:"strict_turn_move"`
	}
	if err := json.Unmarshal(payload, &cmd); err != nil {
		h.sendError(ctx, c, "Payload DM_OVERRIDE inválido")
		return
	}

	if !c.isDM {
		if h.dmPIN != "" && cmd.PIN == h.dmPIN {
			c.isDM = true
		} else {
			h.sendError(ctx, c, "Acceso denegado: requiere permisos del Dungeon Master")
			return
		}
	}

	switch strings.ToUpper(cmd.Action) {
	case "SET_INITIATIVE":
		if err := h.store.SetPlayerInitiative(cmd.TargetPlayerID, cmd.Value); err != nil {
			h.sendError(ctx, c, err.Error())
			return
		}
		_, _ = h.store.AppendActionLog("dm", "Dungeon Master", "DM_OVERRIDE", fmt.Sprintf("Actualizó iniciativa a %d", cmd.Value), nil)

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
			// Notify kicked sockets to reset onboarding if needed
			h.mu.RLock()
			for client := range h.clients {
				if client.playerID == cmd.TargetPlayerID {
					_ = h.sendToClient(ctx, client, WSMessage{Event: "KICKED", PlayerID: cmd.TargetPlayerID})
				}
			}
			h.mu.RUnlock()
			_, _ = h.store.AppendActionLog("dm", "Dungeon Master", "DM_OVERRIDE", fmt.Sprintf("Expulsó a %s de la mesa", p.Name), nil)
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
		h.broadcast(WSMessage{Event: "TOKEN_MOVED", PlayerID: cmd.TargetPlayerID, Payload: movedPayload})

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
