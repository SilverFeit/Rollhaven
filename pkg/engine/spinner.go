package engine

import (
	"fmt"
	"strings"
)

// DefaultSpinnerFaces provides the 6-face factory preset for the Peonza / Pirinola.
var DefaultSpinnerFaces = []string{
	"Pasa turno",
	"Toma 1",
	"Toma 2",
	"Todos ponen",
	"Pon 1",
	"Pon 2",
}

// SpinnerResult represents the server-determined winning face of the spinning top.
type SpinnerResult struct {
	WinningIndex int      `json:"winning_index"`
	Label        string   `json:"label"`
	Faces        []string `json:"faces"`
}

// SpinTop validates 4..12 faces (falling back to the 6-face preset when empty) and chooses one uniformly.
func SpinTop(faces []string) (SpinnerResult, error) {
	clean := make([]string, 0, len(faces))
	for _, f := range faces {
		trimmed := strings.TrimSpace(f)
		if trimmed != "" {
			clean = append(clean, trimmed)
		}
	}
	if len(clean) == 0 {
		clean = append(clean, DefaultSpinnerFaces...)
	}
	if len(clean) < 4 || len(clean) > 12 {
		return SpinnerResult{}, fmt.Errorf("la peonza requiere entre 4 y 12 caras (recibidas: %d)", len(clean))
	}

	idx, err := CryptoRandInt(0, len(clean)-1)
	if err != nil {
		return SpinnerResult{}, err
	}

	return SpinnerResult{
		WinningIndex: idx,
		Label:        clean[idx],
		Faces:        clean,
	}, nil
}
