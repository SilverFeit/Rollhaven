package network

import (
	"net"
	"testing"
)

func TestVirtualInterfaceFilter(t *testing.T) {
	virtual := []string{"docker0", "vboxnet0", "veth1234", "utun3", "tailscale0", "wg0", "vmnet8", "ham0"}
	for _, name := range virtual {
		if !isVirtualInterface(name) {
			t.Errorf("expected %q to be detected as virtual/VPN", name)
		}
	}

	physical := []string{"en0", "en1", "eth0", "wlan0", "Ethernet", "Wi-Fi"}
	for _, name := range physical {
		if isVirtualInterface(name) {
			t.Errorf("expected %q not to be filtered as virtual", name)
		}
	}
}

func TestGetLocalIP(t *testing.T) {
	ipStr, err := GetLocalIP()
	if err != nil {
		t.Fatalf("GetLocalIP error: %v", err)
	}
	ip := net.ParseIP(ipStr)
	if ip == nil || ip.To4() == nil {
		t.Fatalf("expected valid IPv4 address, got %q", ipStr)
	}
}
