package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/SilverFeit/Dicebound/pkg/database"
	"github.com/SilverFeit/Dicebound/pkg/network"
	"github.com/SilverFeit/Dicebound/pkg/server"
	"github.com/SilverFeit/Dicebound/pkg/store"
)

var version = "1.1.2"

func main() {
	port := flag.Int("port", 8080, "Puerto HTTP/WebSocket local del servidor")
	dev := flag.Bool("dev", false, "Modo desarrollo (no abre el navegador automáticamente)")
	noBrowser := flag.Bool("no-browser", false, "Desactivar apertura automática del navegador")
	dataDir := flag.String("data-dir", "", "Directorio de datos para SQLite y uploads (por defecto ./data junto al ejecutable o cwd)")
	pinFlag := flag.String("pin", "", "PIN opcional de 4 dígitos para el Dungeon Master (por defecto autogenerado)")
	showVersion := flag.Bool("version", false, "Mostrar versión y salir")
	flag.Parse()

	if *showVersion {
		fmt.Printf("Dicebound v%s\n", version)
		return
	}

	resolvedDataDir := resolveDataDir(*dataDir)
	dbPath := filepath.Join(resolvedDataDir, "dnd_companion.db")

	db, err := database.Open(dbPath)
	if err != nil {
		log.Fatalf("Error inicializando SQLite (%s): %v", dbPath, err)
	}
	defer db.Close()

	st, err := store.New(db)
	if err != nil {
		log.Fatalf("Error inicializando store: %v", err)
	}

	lanIP, err := network.GetLocalIP()
	if err != nil || lanIP == "" {
		lanIP = "127.0.0.1"
	}

	srv, err := server.New(st, resolvedDataDir, lanIP, *port, *pinFlag)
	if err != nil {
		log.Fatalf("Error inicializando servidor: %v", err)
	}
	srv.Version = version

	addr := fmt.Sprintf("0.0.0.0:%d", *port)
	rawLn, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Error abriendo puerto %s: %v", addr, err)
	}
	dualLn := server.NewDualProtocolListener(rawLn, srv.TLSConfig)

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.Router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	lanURL := fmt.Sprintf("http://%s:%d", lanIP, *port)
	httpsURL := fmt.Sprintf("https://%s:%d", lanIP, *port)
	dmURL := fmt.Sprintf("http://localhost:%d/dm", *port)

	printBanner(lanURL, httpsURL, dmURL, srv.DMPIN, resolvedDataDir)

	go func() {
		if !*dev && !*noBrowser {
			time.Sleep(250 * time.Millisecond)
			openBrowser(dmURL)
		}
	}()

	errCh := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(dualLn); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-errCh:
		log.Fatalf("Error del servidor HTTP: %v", err)
	case sig := <-sigCh:
		fmt.Printf("\nSeñal recibida (%v). Cerrando Dicebound...\n", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(ctx)
	}
}

func resolveDataDir(flagVal string) string {
	if flagVal != "" {
		return flagVal
	}
	// When double-clicked as a macOS .app bundle or Windows .exe, cwd might be read-only (e.g., /).
	// Prefer ./data in cwd when writable; otherwise fall back to executable dir or user home.
	cwd, err := os.Getwd()
	if err == nil && cwd != "/" && isDirWritable(cwd) {
		return filepath.Join(cwd, "data")
	}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		if isDirWritable(exeDir) {
			return filepath.Join(exeDir, "data")
		}
	}
	home, err := os.UserHomeDir()
	if err == nil {
		return filepath.Join(home, "DiceboundData")
	}
	return "./data"
}

func isDirWritable(dir string) bool {
	tmp, err := os.CreateTemp(dir, ".dicebound_write_check_*")
	if err != nil {
		return false
	}
	name := tmp.Name()
	_ = tmp.Close()
	_ = os.Remove(name)
	return true
}

func printBanner(lanURL, httpsURL, dmURL, pin, dataDir string) {
	fmt.Println("================================================================")
	fmt.Printf("  DICEBOUND v%s — D&D Companion LAN Suite\n", version)
	fmt.Println("================================================================")
	fmt.Printf("  [DM Dashboard Local]  : %s\n", dmURL)
	fmt.Printf("  [URL Jugadores HTTP]  : %s\n", lanURL)
	fmt.Printf("  [URL Jugadores HTTPS] : %s  (Sensores / Agitar Móvil)\n", httpsURL)
	fmt.Printf("  [PIN DM (Remoto)]     : %s\n", pin)
	fmt.Printf("  [Base de Datos]       : %s\n", filepath.Join(dataDir, "dnd_companion.db"))
	fmt.Println("----------------------------------------------------------------")
	fmt.Println("  Presiona Ctrl+C para detener el servidor.")
	fmt.Println("================================================================")
}

func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = fmt.Errorf("unsupported platform")
	}
	if err != nil {
		fmt.Printf("Abre manualmente el navegador en: %s\n", url)
	}
}
