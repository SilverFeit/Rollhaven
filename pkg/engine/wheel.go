package engine

import (
	"fmt"
	"strings"
)

// DefaultWheelOptions provides starter options for the decision wheel.
var DefaultWheelOptions = []string{
	"Atacar",
	"Huir",
	"Usar Poción",
	"Esconderse",
	"Negociar",
	"Investigar",
}

// WheelResult represents the server-determined winning slice of the decision wheel.
type WheelResult struct {
	WinningIndex int      `json:"winning_index"`
	Option       string   `json:"option"`
	Options      []string `json:"options"`
}

// SpinWheel validates 2..24 options and picks a winning slice uniformly via crypto/rand.
func SpinWheel(options []string) (WheelResult, error) {
	clean := make([]string, 0, len(options))
	for _, opt := range options {
		trimmed := strings.TrimSpace(opt)
		if trimmed != "" {
			clean = append(clean, trimmed)
		}
	}
	if len(clean) == 0 {
		clean = append(clean, DefaultWheelOptions...)
	}
	if len(clean) < 2 || len(clean) > 24 {
		return WheelResult{}, fmt.Errorf("la ruleta requiere entre 2 y 24 opciones (recibidas: %d)", len(clean))
	}

	idx, err := CryptoRandInt(0, len(clean)-1)
	if err != nil {
		return WheelResult{}, err
	}

	return WheelResult{
		WinningIndex: idx,
		Option:       clean[idx],
		Options:      clean,
	}, nil
}
