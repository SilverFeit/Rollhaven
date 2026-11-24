package server

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	appembed "github.com/SilverFeit/Rollhaven/pkg/embed"
	"github.com/SilverFeit/Rollhaven/pkg/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
)

// Server encapsulates the HTTP router, WebSocket hub, storage, and upload paths.
type Server struct {
	Router    *chi.Mux
	Hub       *Hub
	Store     *store.Store
	DataDir   string
	UploadDir string
	LanIP     string
	Port      int
	DMPIN     string
	Version   string
	TLSConfig *tls.Config
	CACertPEM []byte
}

// GenerateSessionPIN creates a random 4-digit numeric PIN using crypto/rand.
func GenerateSessionPIN() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(9000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", 1000+n.Int64()), nil
}

// New builds the full HTTP + WebSocket server and registers all REST & SPA routes.
func New(st *store.Store, dataDir, lanIP string, port int, dmPIN string) (*Server, error) {
	uploadDir := filepath.Join(dataDir, "uploads")
	if err := os.MkdirAll(filepath.Join(uploadDir, "maps"), 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(uploadDir, "sheets"), 0o755); err != nil {
		return nil, err
	}

	if dmPIN == "" {
		pin, err := GenerateSessionPIN()
		if err != nil {
			return nil, err
		}
		dmPIN = pin
	}

	tlsAssets, err := EnsureTLSAssets(dataDir, lanIP)
	if err != nil {
		return nil, fmt.Errorf("init tls assets: %w", err)
	}

	hub := NewHub(st, lanIP, port, dmPIN)
	s := &Server{
		Router:    chi.NewRouter(),
		Hub:       hub,
		Store:     st,
		DataDir:   dataDir,
		UploadDir: uploadDir,
		LanIP:     lanIP,
		Port:      port,
		DMPIN:     dmPIN,
		Version:   "1.3.0",
		TLSConfig: tlsAssets.Config,
		CACertPEM: tlsAssets.CACertPEM,
	}
	s.mountRoutes()
	return s, nil
}

func (s *Server) isDMAuthorized(r *http.Request) (authorized bool, isLocal bool) {
	ip := extractClientIP(r)
	if isLocalhostIP(ip) {
		return true, true
	}
	pin := strings.TrimSpace(r.Header.Get("X-DM-PIN"))
	if pin == "" {
		pin = strings.TrimSpace(r.URL.Query().Get("pin"))
	}
	if pin == "" {
		if ck, err := r.Cookie("rollhaven_dm_pin"); err == nil {
			pin = strings.TrimSpace(ck.Value)
		}
	}
	return pin != "" && pin == s.DMPIN, false
}

func (s *Server) mountRoutes() {
	r := s.Router
	r.Use(middleware.Recoverer)

	// WebSocket endpoint
	r.Get("/ws", s.Hub.HandleWS)

	// REST API v1
	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/health", s.handleHealth)
		api.Get("/state", s.handlePublicState)
		api.Get("/tls/ca.crt", s.handleDownloadCACert)

		api.Get("/dm/status", s.handleDMStatus)
		api.Post("/dm/auth", s.handleDMAuth)
		api.Get("/dm/notes", s.handleGetDMNotes)
		api.Put("/dm/notes", s.handleSaveDMNotes)

		api.Post("/upload/map", s.handleUploadMap)
		api.Post("/upload/sheet", s.handleUploadSheet)

		api.Get("/player/{id}/notes", s.handleGetPlayerNotes)
		api.Put("/player/{id}/notes", s.handleSavePlayerNotes)
		api.Get("/player/{id}/inventory", s.handleListInventory)
		api.Post("/player/{id}/inventory", s.handleUpsertInventory)
		api.Put("/player/{id}/inventory/{itemId}", s.handleUpdateInventoryItem)
		api.Delete("/player/{id}/inventory/{itemId}", s.handleDeleteInventoryItem)
	})

	// Serve uploaded maps & character sheets
	r.Get("/uploads/*", s.handleServeUpload)

	// Embedded React SPA (with fallback to index.html for /dm and client routes)
	spaFS := appembed.GetFileSystem()
	fileServer := http.FileServer(spaFS)
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		cleanPath := strings.TrimPrefix(req.URL.Path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}
		if f, err := spaFS.Open(cleanPath); err == nil {
			stat, statErr := f.Stat()
			_ = f.Close()
			if statErr == nil && !stat.IsDir() {
				fileServer.ServeHTTP(w, req)
				return
			}
		}
		// SPA fallback to index.html
		idx, err := spaFS.Open("index.html")
		if err != nil {
			http.Error(w, "Frontend assets not embedded", http.StatusInternalServerError)
			return
		}
		defer idx.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.Copy(w, idx)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ver := s.Version
	if ver == "" {
		ver = "1.3.0"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"app":     "Rollhaven",
		"version": ver,
		"license": "MIT",
		"lan_ip":  s.LanIP,
		"port":    s.Port,
	})
}

func (s *Server) handleDownloadCACert(w http.ResponseWriter, r *http.Request) {
	if len(s.CACertPEM) == 0 {
		http.Error(w, "CA certificate not available", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="rollhaven-ca.crt"`)
	_, _ = w.Write(s.CACertPEM)
}

func (s *Server) handlePublicState(w http.ResponseWriter, r *http.Request) {
	snap, err := s.Hub.BuildSnapshot()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handleDMStatus(w http.ResponseWriter, r *http.Request) {
	authorized, isLocal := s.isDMAuthorized(r)
	resp := map[string]any{
		"authorized":   authorized,
		"is_localhost": isLocal,
		"lan_ip":       s.LanIP,
		"port":         s.Port,
	}
	if authorized {
		resp["pin"] = s.DMPIN
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleDMAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PIN string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido"})
		return
	}
	if strings.TrimSpace(body.PIN) != s.DMPIN {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "PIN incorrecto"})
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "rollhaven_dm_pin",
		Value:    s.DMPIN,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(24 * time.Hour),
	})
	writeJSON(w, http.StatusOK, map[string]any{"authorized": true, "pin": s.DMPIN})
}

func (s *Server) handleGetDMNotes(w http.ResponseWriter, r *http.Request) {
	authorized, _ := s.isDMAuthorized(r)
	if !authorized {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Acceso denegado"})
		return
	}
	notes, err := s.Store.GetDMNotes()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": notes})
}

func (s *Server) handleSaveDMNotes(w http.ResponseWriter, r *http.Request) {
	authorized, _ := s.isDMAuthorized(r)
	if !authorized {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Acceso denegado"})
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido"})
		return
	}
	if err := s.Store.SaveDMNotes(body.Content); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "saved"})
}

func (s *Server) handleUploadMap(w http.ResponseWriter, r *http.Request) {
	authorized, _ := s.isDMAuthorized(r)
	if !authorized {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Solo el Dungeon Master puede subir mapas"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 25<<20) // 25 MB max map
	if err := r.ParseMultipartForm(25 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "El archivo excede 25 MB o es inválido"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Campo 'file' requerido"})
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Formato de mapa no soportado (usa PNG, JPG, WebP)"})
		return
	}

	filename := fmt.Sprintf("map_%s%s", uuid.NewString()[:8], ext)
	dstPath := filepath.Join(s.UploadDir, "maps", filename)
	dst, err := os.Create(dstPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	publicPath := "/uploads/maps/" + filename
	if err := s.Store.SetMapImagePath(publicPath); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	// Automatically enable map if DM uploads one? Let's keep current toggle or allow DM toggle,
	// or auto-enable if it was disabled with no image before. Let's leave toggle explicit or return path.
	s.Hub.BroadcastStateSync()
	writeJSON(w, http.StatusOK, map[string]string{"file_path": publicPath})
}

func (s *Server) handleUploadSheet(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10 MB max (SDD-05)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "La hoja supera el límite de 10 MB"})
		return
	}

	playerID := strings.TrimSpace(r.FormValue("player_id"))
	if playerID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "player_id requerido"})
		return
	}
	if _, err := s.Store.GetPlayer(playerID); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Jugador no encontrado"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Campo 'file' requerido"})
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	switch ext {
	case ".pdf", ".png", ".jpg", ".jpeg", ".webp":
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Formato permitido: PDF, PNG, JPEG, WebP"})
		return
	}

	safeID := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, playerID)

	filename := fmt.Sprintf("%s_%d%s", safeID, time.Now().Unix(), ext)
	dstPath := filepath.Join(s.UploadDir, "sheets", filename)
	dst, err := os.Create(dstPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	publicPath := "/uploads/sheets/" + filename
	if err := s.Store.SetCharacterSheetPath(playerID, publicPath); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.Hub.BroadcastStateSync()
	writeJSON(w, http.StatusOK, map[string]string{"file_path": publicPath})
}

func (s *Server) handleServeUpload(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/uploads/")
	clean := filepath.Clean(rel)
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	fullPath := filepath.Join(s.UploadDir, clean)
	absUpload, _ := filepath.Abs(s.UploadDir)
	absTarget, _ := filepath.Abs(fullPath)
	if !strings.HasPrefix(absTarget, absUpload+string(os.PathSeparator)) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	http.ServeFile(w, r, fullPath)
}

func (s *Server) handleGetPlayerNotes(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	content, err := s.Store.GetPlayerNotes(pid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": content})
}

func (s *Server) handleSavePlayerNotes(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido"})
		return
	}
	if err := s.Store.SavePlayerNotes(pid, body.Content); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

func (s *Server) handleListInventory(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	items, err := s.Store.ListInventory(pid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleUpsertInventory(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	var body struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Quantity    int    `json:"quantity"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido"})
		return
	}
	item, err := s.Store.UpsertInventoryItem(pid, body.ID, body.Name, body.Quantity, body.Description)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.Hub.BroadcastStateSync()
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateInventoryItem(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")
	var body struct {
		Name        string `json:"name"`
		Quantity    int    `json:"quantity"`
		Delta       *int   `json:"delta"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido"})
		return
	}
	if body.Delta != nil {
		if err := s.Store.AdjustInventoryQuantity(pid, itemID, *body.Delta); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		s.Hub.BroadcastStateSync()
		writeJSON(w, http.StatusOK, map[string]string{"status": "adjusted"})
		return
	}
	item, err := s.Store.UpsertInventoryItem(pid, itemID, body.Name, body.Quantity, body.Description)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.Hub.BroadcastStateSync()
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteInventoryItem(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")
	if err := s.Store.DeleteInventoryItem(pid, itemID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.Hub.BroadcastStateSync()
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
