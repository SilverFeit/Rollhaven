package server

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

var tunnelURLRegex = regexp.MustCompile(`https://[a-zA-Z0-9.-]+\.(?:trycloudflare\.com|lhr\.life|localhost\.run)`)

// TunnelStatus reports the state of the optional public HTTPS tunnel (Solution 2: zero client cert config).
type TunnelStatus struct {
	Active       bool   `json:"active"`
	PublicURL    string `json:"public_url"`
	Provider     string `json:"provider"`
	ErrorMessage string `json:"error_message,omitempty"`
}

// TunnelManager manages an on-demand public HTTPS reverse tunnel subprocess pointing to the local Rollhaven port.
type TunnelManager struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	cancel context.CancelFunc
	status TunnelStatus
}

// NewTunnelManager builds a fresh TunnelManager.
func NewTunnelManager() *TunnelManager {
	return &TunnelManager{}
}

// Status returns a consistent snapshot of the public tunnel state.
func (tm *TunnelManager) Status() TunnelStatus {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	return tm.status
}

func findCloudflared() string {
	candidates := []string{
		"cloudflared",
		"/opt/homebrew/bin/cloudflared",
		"/usr/local/bin/cloudflared",
		"/usr/bin/cloudflared",
	}
	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// Start launches an HTTPS tunnel with a publicly trusted CA certificate via cloudflared or SSH localhost.run.
func (tm *TunnelManager) Start(port int) TunnelStatus {
	_ = tm.Stop()

	cfBin := findCloudflared()
	provider := "cloudflared (Cloudflare TryCloudflare)"
	var args []string
	bin := cfBin

	if bin != "" {
		args = []string{"tunnel", "--url", fmt.Sprintf("http://127.0.0.1:%d", port), "--no-autoupdate"}
	} else {
		sshBin, err := exec.LookPath("ssh")
		if err != nil {
			tm.mu.Lock()
			tm.status = TunnelStatus{
				Active:       false,
				Provider:     "unavailable",
				ErrorMessage: "Ni 'cloudflared' ni 'ssh' están disponibles en este equipo para abrir túnel público.",
			}
			tm.mu.Unlock()
			return tm.Status()
		}
		bin = sshBin
		provider = "ssh (localhost.run)"
		args = []string{
			"-T",
			"-o", "StrictHostKeyChecking=no",
			"-o", "UserKnownHostsFile=/dev/null",
			"-o", "ServerAliveInterval=30",
			"-o", "ExitOnForwardFailure=yes",
			"-R", fmt.Sprintf("80:127.0.0.1:%d", port),
			"nokey@localhost.run",
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, bin, args...)

	stdout, errOut := cmd.StdoutPipe()
	stderr, errErr := cmd.StderrPipe()
	if errOut != nil || errErr != nil {
		cancel()
		tm.mu.Lock()
		tm.status = TunnelStatus{Active: false, Provider: provider, ErrorMessage: "No se pudieron abrir pipes del túnel"}
		tm.mu.Unlock()
		return tm.Status()
	}

	if err := cmd.Start(); err != nil {
		cancel()
		tm.mu.Lock()
		tm.status = TunnelStatus{Active: false, Provider: provider, ErrorMessage: err.Error()}
		tm.mu.Unlock()
		return tm.Status()
	}

	urlCh := make(chan string, 1)
	var lastErr strings.Builder
	var errMu sync.Mutex

	scanReader := func(r io.Reader) {
		sc := bufio.NewScanner(r)
		for sc.Scan() {
			line := sc.Text()
			if match := tunnelURLRegex.FindString(line); match != "" {
				select {
				case urlCh <- match:
				default:
				}
			}
			errMu.Lock()
			if lastErr.Len() < 600 && strings.TrimSpace(line) != "" {
				lastErr.WriteString(strings.TrimSpace(line))
				lastErr.WriteByte(' ')
			}
			errMu.Unlock()
		}
	}
	go scanReader(stdout)
	go scanReader(stderr)

	doneCh := make(chan error, 1)
	go func() {
		err := cmd.Wait()
		tm.mu.Lock()
		if tm.cmd == cmd {
			tm.cmd = nil
			tm.cancel = nil
			tm.status.Active = false
			if err != nil && ctx.Err() == nil {
				tm.status.ErrorMessage = fmt.Sprintf("Túnel cerrado: %v", err)
			}
		}
		tm.mu.Unlock()
		doneCh <- err
	}()

	tm.mu.Lock()
	tm.cmd = cmd
	tm.cancel = cancel
	tm.status = TunnelStatus{Active: false, Provider: provider}
	tm.mu.Unlock()

	select {
	case url := <-urlCh:
		tm.mu.Lock()
		tm.status = TunnelStatus{
			Active:    true,
			PublicURL: url,
			Provider:  provider,
		}
		st := tm.status
		tm.mu.Unlock()
		return st
	case err := <-doneCh:
		cancel()
		errMu.Lock()
		msg := strings.TrimSpace(lastErr.String())
		errMu.Unlock()
		if msg == "" && err != nil {
			msg = err.Error()
		}
		tm.mu.Lock()
		tm.status = TunnelStatus{
			Active:       false,
			Provider:     provider,
			ErrorMessage: "No se pudo establecer el túnel público: " + msg,
		}
		st := tm.status
		tm.mu.Unlock()
		return st
	case <-time.After(15 * time.Second):
		_ = tm.Stop()
		tm.mu.Lock()
		tm.status = TunnelStatus{
			Active:       false,
			Provider:     provider,
			ErrorMessage: "Tiempo de espera agotado (15s) obteniendo URL pública del túnel.",
		}
		st := tm.status
		tm.mu.Unlock()
		return st
	}
}

// Stop terminates any active public HTTPS tunnel cleanly.
func (tm *TunnelManager) Stop() error {
	tm.mu.Lock()
	cancel := tm.cancel
	cmd := tm.cmd
	tm.cmd = nil
	tm.cancel = nil
	tm.status = TunnelStatus{Active: false}
	tm.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	return nil
}
