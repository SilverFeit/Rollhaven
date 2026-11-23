package engine

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var diceNotationRegex = regexp.MustCompile(`^\s*(\d*)[dD](\d+)\s*([+-]\s*\d+)?\s*$`)

// StandardDice lists all polyhedral dice required by D&D.
var StandardDice = []int{2, 4, 6, 8, 10, 12, 20, 100}

// DiceResult captures the outcome of a polyhedral dice roll.
type DiceResult struct {
	Notation   string `json:"notation"`
	Count      int    `json:"count"`
	Sides      int    `json:"sides"`
	Modifier   int    `json:"modifier"`
	Rolls      []int  `json:"rolls"`
	Subtotal   int    `json:"subtotal"`
	Total      int    `json:"total"`
	IsCritical bool   `json:"is_critical"`
	IsFumble   bool   `json:"is_fumble"`
}

// ParseDiceNotation parses expressions like "d20", "1d20+3", "2d6-1", "1d100".
func ParseDiceNotation(notation string) (count, sides, modifier int, normalized string, err error) {
	matches := diceNotationRegex.FindStringSubmatch(notation)
	if matches == nil {
		return 0, 0, 0, "", fmt.Errorf("notación de dado inválida: %q (usa NdX+M, ej. 1d20+3)", notation)
	}

	count = 1
	if matches[1] != "" {
		count, err = strconv.Atoi(matches[1])
		if err != nil || count < 1 || count > 100 {
			return 0, 0, 0, "", fmt.Errorf("cantidad de dados debe estar entre 1 y 100")
		}
	}

	sides, err = strconv.Atoi(matches[2])
	if err != nil || sides < 2 || sides > 10000 {
		return 0, 0, 0, "", fmt.Errorf("número de caras inválido: %q", matches[2])
	}

	if matches[3] != "" {
		modStr := strings.ReplaceAll(matches[3], " ", "")
		modifier, err = strconv.Atoi(modStr)
		if err != nil || modifier < -1000 || modifier > 1000 {
			return 0, 0, 0, "", fmt.Errorf("modificador fuera de rango (-1000 a +1000)")
		}
	}

	if modifier > 0 {
		normalized = fmt.Sprintf("%dd%d+%d", count, sides, modifier)
	} else if modifier < 0 {
		normalized = fmt.Sprintf("%dd%d%d", count, sides, modifier)
	} else {
		normalized = fmt.Sprintf("%dd%d", count, sides)
	}

	return count, sides, modifier, normalized, nil
}

// RollDice evaluates a dice notation using crypto/rand and detects d20 natural 20 / natural 1.
func RollDice(notation string) (DiceResult, error) {
	count, sides, modifier, normalized, err := ParseDiceNotation(notation)
	if err != nil {
		return DiceResult{}, err
	}

	rolls := make([]int, 0, count)
	subtotal := 0
	hasNat20 := false
	hasNat1 := false

	for i := 0; i < count; i++ {
		val, err := CryptoRandInt(1, sides)
		if err != nil {
			return DiceResult{}, err
		}
		rolls = append(rolls, val)
		subtotal += val
		if sides == 20 {
			if val == 20 {
				hasNat20 = true
			} else if val == 1 {
				hasNat1 = true
			}
		}
	}

	return DiceResult{
		Notation:   normalized,
		Count:      count,
		Sides:      sides,
		Modifier:   modifier,
		Rolls:      rolls,
		Subtotal:   subtotal,
		Total:      subtotal + modifier,
		IsCritical: hasNat20,
		IsFumble:   hasNat1 && !hasNat20,
	}, nil
}
