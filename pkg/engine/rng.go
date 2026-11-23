package engine

import (
	"crypto/rand"
	"fmt"
	"math/big"
)

// CryptoRandInt returns a cryptographically uniform random integer in [min, max].
func CryptoRandInt(min, max int) (int, error) {
	if max < min {
		return 0, fmt.Errorf("invalid range: min (%d) > max (%d)", min, max)
	}
	if max == min {
		return min, nil
	}
	span := int64(max - min + 1)
	nBig, err := rand.Int(rand.Reader, big.NewInt(span))
	if err != nil {
		return 0, fmt.Errorf("crypto/rand failure: %w", err)
	}
	return min + int(nBig.Int64()), nil
}
