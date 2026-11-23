package server

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
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
	"path/filepath"
	"sync"
	"time"
)

// TLSAssets holds the local Root CA PEM and the server tls.Config for HTTPS + WSS on LAN.
type TLSAssets struct {
	Config    *tls.Config
	CACertPEM []byte
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
		Config:    cfg,
		CACertPEM: caPEM,
	}, nil
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
	if parsed := net.ParseIP(lanIP); parsed != nil {
		ips = append(ips, parsed)
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
		DNSNames:    []string{"localhost", "rollhaven.local"},
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
