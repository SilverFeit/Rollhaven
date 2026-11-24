package server

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// TLSAssets holds the local Root CA PEM, path, fingerprint, and tls.Config for HTTPS + WSS on LAN.
type TLSAssets struct {
	Config              *tls.Config
	CACertPEM           []byte
	CACertPath          string
	CAFingerprintSHA256 string
}

// EnsureTLSAssets loads or generates a persistent local Root CA under <dataDir>/tls/
// and issues an ephemeral leaf certificate signed for localhost, 127.0.0.1, and lanIP.
func EnsureTLSAssets(dataDir, lanIP string) (*TLSAssets, error) {
	tlsDir := filepath.Join(dataDir, "tls")
	if err := os.MkdirAll(tlsDir, 0o755); err != nil {
		return nil, fmt.Errorf("create tls dir: %w", err)
	}

	caCertPath := filepath.Join(tlsDir, "rollhaven-ca.crt")
	caKeyPath := filepath.Join(tlsDir, "rollhaven-ca.key")

	caCert, caKey, caPEM, err := loadOrCreateCA(caCertPath, caKeyPath)
	if err != nil {
		return nil, err
	}

	leafCert, err := issueServerCert(caCert, caKey, lanIP)
	if err != nil {
		return nil, err
	}

	cfg := &tls.Config{
		Certificates: []tls.Certificate{leafCert},
		MinVersion:   tls.VersionTLS12,
		// Force HTTP/1.1 so WebSocket Upgrades (wss://) work with http.Hijacker across all browsers.
		NextProtos: []string{"http/1.1"},
	}

	return &TLSAssets{
		Config:              cfg,
		CACertPEM:           caPEM,
		CACertPath:          caCertPath,
		CAFingerprintSHA256: CACertFingerprintSHA256(caPEM),
	}, nil
}

// CACertFingerprintSHA256 formats the SHA-256 fingerprint of a PEM CA certificate.
func CACertFingerprintSHA256(caPEM []byte) string {
	block, _ := pem.Decode(caPEM)
	if block == nil {
		return ""
	}
	sum := sha256.Sum256(block.Bytes)
	parts := make([]string, len(sum))
	for i, b := range sum {
		parts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, ":")
}

// BuildSSLIPHost returns the canonical sslip.io DNS alias for a LAN IPv4 address.
func BuildSSLIPHost(lanIP string) string {
	clean := strings.TrimSpace(lanIP)
	if clean == "" {
		return ""
	}
	return strings.ReplaceAll(strings.ReplaceAll(clean, ".", "-"), ":", "-") + ".sslip.io"
}

// IsHostCATrusted checks whether the host OS already trusts the local Rollhaven Root CA.
func IsHostCATrusted(caCertPath string) bool {
	if strings.TrimSpace(caCertPath) == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	switch runtime.GOOS {
	case "darwin":
		cmd := exec.CommandContext(ctx, "security", "verify-cert", "-c", caCertPath)
		return cmd.Run() == nil
	case "windows":
		cmd := exec.CommandContext(ctx, "certutil", "-user", "-verifystore", "Root", "Rollhaven Local LAN Root CA")
		return cmd.Run() == nil
	default:
		return false
	}
}

// TrustCAOnHost installs rollhaven-ca.crt into the host OS user trust store (or opens Keychain Access on macOS if prompt is required).
func TrustCAOnHost(caCertPath string) (trusted bool, message string, err error) {
	if strings.TrimSpace(caCertPath) == "" {
		return false, "", fmt.Errorf("ruta de certificado CA vacía")
	}
	if IsHostCATrusted(caCertPath) {
		return true, "Este equipo ya confía en el certificado raíz local de Rollhaven.", nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		loginKC := filepath.Join(home, "Library", "Keychains", "login.keychain-db")
		out, cmdErr := exec.CommandContext(ctx, "security", "add-trusted-cert", "-r", "trustRoot", "-k", loginKC, caCertPath).CombinedOutput()
		if cmdErr == nil && IsHostCATrusted(caCertPath) {
			return true, "Certificado instalado y confiado en tu Llavero de inicio de sesión (macOS). Reinicia el navegador para ver el candado.", nil
		}
		// Fallback: open certificate directly in Keychain Access UI for explicit user confirmation
		_ = exec.Command("open", "-a", "Keychain Access", caCertPath).Run()
		hint := strings.TrimSpace(string(out))
		if hint != "" {
			hint = " (" + hint + ")"
		}
		return false, "Se abrió Acceso a Llaveros con rollhaven-ca.crt. Haz doble clic en 'Rollhaven Local LAN Root CA' → Confiar → Confiar siempre" + hint, nil

	case "windows":
		out, cmdErr := exec.CommandContext(ctx, "certutil", "-user", "-addstore", "Root", caCertPath).CombinedOutput()
		if cmdErr == nil {
			return true, "Certificado instalado en el almacén Raíz de usuario en Windows. Reinicia el navegador.", nil
		}
		return false, "", fmt.Errorf("certutil falló (%v): %s", cmdErr, strings.TrimSpace(string(out)))

	default:
		return false, fmt.Sprintf("Instala manualmente %s en el almacén de certificados de confianza de tu sistema.", caCertPath), nil
	}
}

func loadOrCreateCA(certPath, keyPath string) (*x509.Certificate, *ecdsa.PrivateKey, []byte, error) {
	certBytes, errCert := os.ReadFile(certPath)
	keyBytes, errKey := os.ReadFile(keyPath)
	if errCert == nil && errKey == nil {
		blockCert, _ := pem.Decode(certBytes)
		blockKey, _ := pem.Decode(keyBytes)
		if blockCert != nil && blockKey != nil {
			cert, e1 := x509.ParseCertificate(blockCert.Bytes)
			key, e2 := x509.ParseECPrivateKey(blockKey.Bytes)
			if e1 == nil && e2 == nil && time.Now().Before(cert.NotAfter.Add(-24*time.Hour)) {
				return cert, key, certBytes, nil
			}
		}
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, nil, err
	}

	now := time.Now().UTC()
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "Rollhaven Local LAN Root CA",
			Organization: []string{"Rollhaven LAN Suite"},
		},
		NotBefore:             now.Add(-1 * time.Hour),
		NotAfter:              now.Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            0,
		MaxPathLenZero:        true,
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, nil, err
	}
	cert, err := x509.ParseCertificate(derBytes)
	if err != nil {
		return nil, nil, nil, err
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, nil, err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	_ = os.WriteFile(certPath, certPEM, 0o644)
	_ = os.WriteFile(keyPath, keyPEM, 0o600)

	return cert, key, certPEM, nil
}

func issueServerCert(caCert *x509.Certificate, caKey *ecdsa.PrivateKey, lanIP string) (tls.Certificate, error) {
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, err
	}

	ips := []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}
	dnsNames := []string{"localhost", "rollhaven.local"}
	if parsed := net.ParseIP(lanIP); parsed != nil {
		ips = append(ips, parsed)
		if sslip := BuildSSLIPHost(lanIP); sslip != "" {
			dnsNames = append(dnsNames, sslip, strings.Replace(sslip, ".sslip.io", ".nip.io", 1))
		}
	}

	now := time.Now().UTC()
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "Rollhaven LAN Server",
			Organization: []string{"Rollhaven"},
		},
		NotBefore:   now.Add(-1 * time.Hour),
		NotAfter:    now.Add(820 * 24 * time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:    dnsNames,
		IPAddresses: ips,
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, err
	}

	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	keyDER, err := x509.MarshalECPrivateKey(leafKey)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	return tls.X509KeyPair(leafPEM, keyPEM)
}

type peekedConn struct {
	net.Conn
	r io.Reader
}

func (c *peekedConn) Read(p []byte) (int, error) {
	return c.r.Read(p)
}

type acceptResult struct {
	conn net.Conn
	err  error
}

// DualProtocolListener multiplexes plain HTTP (ws://) and TLS HTTPS (wss://) on the same TCP port
// by peeking the first byte of each incoming connection (0x16 indicates a TLS ClientHello).
type DualProtocolListener struct {
	inner     net.Listener
	tlsConfig *tls.Config
	readyCh   chan acceptResult
	quitCh    chan struct{}
	closeOnce sync.Once
}

// NewDualProtocolListener wraps inner so it accepts both HTTP and HTTPS connections concurrently.
func NewDualProtocolListener(inner net.Listener, tlsConfig *tls.Config) *DualProtocolListener {
	d := &DualProtocolListener{
		inner:     inner,
		tlsConfig: tlsConfig,
		readyCh:   make(chan acceptResult, 64),
		quitCh:    make(chan struct{}),
	}
	go d.acceptLoop()
	return d
}

func (d *DualProtocolListener) acceptLoop() {
	for {
		rawConn, err := d.inner.Accept()
		if err != nil {
			select {
			case <-d.quitCh:
				return
			case d.readyCh <- acceptResult{err: err}:
				if errors.Is(err, net.ErrClosed) {
					return
				}
			}
			continue
		}

		go func(c net.Conn) {
			_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
			var first [1]byte
			n, readErr := c.Read(first[:])
			_ = c.SetReadDeadline(time.Time{})

			if readErr != nil && n == 0 {
				_ = c.Close()
				return
			}

			bc := &peekedConn{
				Conn: c,
				r:    io.MultiReader(bytes.NewReader(first[:n]), c),
			}

			var out net.Conn = bc
			if n > 0 && first[0] == 0x16 && d.tlsConfig != nil {
				out = tls.Server(bc, d.tlsConfig)
			}

			select {
			case d.readyCh <- acceptResult{conn: out}:
			case <-d.quitCh:
				_ = out.Close()
			}
		}(rawConn)
	}
}

func (d *DualProtocolListener) Accept() (net.Conn, error) {
	select {
	case res := <-d.readyCh:
		return res.conn, res.err
	case <-d.quitCh:
		return nil, net.ErrClosed
	}
}

func (d *DualProtocolListener) Close() error {
	var err error
	d.closeOnce.Do(func() {
		close(d.quitCh)
		err = d.inner.Close()
	})
	return err
}

func (d *DualProtocolListener) Addr() net.Addr {
	return d.inner.Addr()
}
