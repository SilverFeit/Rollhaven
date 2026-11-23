package network

import (
	"net"
	"strings"
)

var virtualOrVPNPrefixes = []string{
	"docker", "vbox", "vmnet", "vmware", "veth", "virbr", "br-",
	"utun", "tun", "tap", "wg", "tailscale", "hamachi", "ham0", "zerotier",
	"wsl", "vethernet", "hyper-v", "anpi", "awdl", "llw", "bridge",
}

func isVirtualInterface(name string) bool {
	lower := strings.ToLower(name)
	for _, p := range virtualOrVPNPrefixes {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

func isPrivateIPv4(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	if ip4[0] == 10 {
		return true
	}
	if ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31 {
		return true
	}
	if ip4[0] == 192 && ip4[1] == 168 {
		return true
	}
	return false
}

// GetLocalIP inspects active network interfaces and returns the primary LAN IPv4 address,
// filtering loopback, virtual adapters (Docker, VirtualBox, VMWare, WSL), and VPN tunnels.
func GetLocalIP() (string, error) {
	candidates, err := GetAllCandidateIPs()
	if err != nil {
		return "127.0.0.1", err
	}
	if len(candidates) > 0 {
		return candidates[0], nil
	}
	return "127.0.0.1", nil
}

// GetAllCandidateIPs returns all active non-virtual LAN IPv4 addresses sorted with RFC1918 private IPs first.
func GetAllCandidateIPs() ([]string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}

	var privateIPs []string
	var otherIPs []string

	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if isVirtualInterface(iface.Name) {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			ip4 := ip.To4()
			if ip4 == nil {
				continue
			}
			if isPrivateIPv4(ip4) {
				privateIPs = append(privateIPs, ip4.String())
			} else {
				otherIPs = append(otherIPs, ip4.String())
			}
		}
	}

	return append(privateIPs, otherIPs...), nil
}
