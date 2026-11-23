package engine

import (
	"crypto/rand"
	"math/big"
)

// CoinResult represents the physical landing side of a fair coin.
type CoinResult string

const (
	Cara  CoinResult = "CARA"
	Cruz  CoinResult = "CRUZ"
	Canto CoinResult = "CANTO"
)

// CoinOutcome contains the coin side and metadata for broadcasts.
type CoinOutcome struct {
	RawValue        CoinResult `json:"raw_value"`
	DisplayLabel    string     `json:"display_label"`
	ProbabilityOdds string     `json:"probability_odds"`
	IsEdge          bool       `json:"is_edge"`
}

// FlipCoin simulates a realistic coin flip:
// - CANTO: 1/6000 (~0.0166667%)
// - CARA:  5999/12000 (~49.9916667%)
// - CRUZ:  5999/12000 (~49.9916667%)
func FlipCoin() (CoinResult, error) {
	nBig, err := rand.Int(rand.Reader, big.NewInt(12000))
	if err != nil {
		return "", err
	}
	val := nBig.Int64()

	// 0 and 1 correspond to Canto (2/12000 = 1/6000)
	if val < 2 {
		return Canto, nil
	} else if val < 6001 {
		return Cara, nil
	}
	return Cruz, nil
}

// FlipCoinDetailed returns the CoinResult enriched with display copy and probability metadata.
func FlipCoinDetailed() (CoinOutcome, error) {
	res, err := FlipCoin()
	if err != nil {
		return CoinOutcome{}, err
	}
	switch res {
	case Canto:
		return CoinOutcome{
			RawValue:        Canto,
			DisplayLabel:    "¡LA MONEDA QUEDÓ PARADA EN EL CANTO!",
			ProbabilityOdds: "1 in 6000 (0.0167%)",
			IsEdge:          true,
		}, nil
	case Cara:
		return CoinOutcome{
			RawValue:        Cara,
			DisplayLabel:    "CARA",
			ProbabilityOdds: "5999 in 12000 (49.9917%)",
			IsEdge:          false,
		}, nil
	default:
		return CoinOutcome{
			RawValue:        Cruz,
			DisplayLabel:    "CRUZ",
			ProbabilityOdds: "5999 in 12000 (49.9917%)",
			IsEdge:          false,
		}, nil
	}
}
