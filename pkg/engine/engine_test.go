package engine_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/SilverFeit/Rollhaven/pkg/engine"
)

func TestNoMathRandInEngine(t *testing.T) {
	fset := token.NewFileSet()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read engine dir: %v", err)
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(".", e.Name()), nil, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parse %s: %v", e.Name(), err)
		}
		for _, imp := range f.Imports {
			if imp.Path.Value == `"math/rand"` || imp.Path.Value == `"math/rand/v2"` {
				t.Fatalf("forbidden math/rand import found in %s", e.Name())
			}
		}
	}
}

func TestCoinMonteCarlo(t *testing.T) {
	const iterations = 600000
	cantoCount := 0
	caraCount := 0
	cruzCount := 0

	for i := 0; i < iterations; i++ {
		res, err := engine.FlipCoin()
		if err != nil {
			t.Fatalf("Error lanzando moneda: %v", err)
		}
		switch res {
		case engine.Canto:
			cantoCount++
		case engine.Cara:
			caraCount++
		case engine.Cruz:
			cruzCount++
		default:
			t.Fatalf("Resultado desconocido: %q", res)
		}
	}

	// Para 600,000 lanzamientos, la media esperada es 100 cantos.
	// Tolerancia aceptable (SDD-07): entre 70 y 130 cantos.
	if cantoCount < 70 || cantoCount > 130 {
		t.Errorf("Distribución de Canto fuera de tolerancia estadística. Esperado ~100, obtenido: %d", cantoCount)
	}
	if caraCount < 295000 || cruzCount < 295000 {
		t.Errorf("Distribución de Cara/Cruz sesgada: cara=%d cruz=%d", caraCount, cruzCount)
	}
	t.Logf("Monte Carlo (n=%d): CANTO=%d (%.4f%%), CARA=%d, CRUZ=%d",
		iterations, cantoCount, float64(cantoCount)*100/float64(iterations), caraCount, cruzCount)
}

func TestDiceNotationAndAllStandardDice(t *testing.T) {
	for _, sides := range engine.StandardDice {
		notation := "1d" + string(rune('0'))
		switch sides {
		case 2:
			notation = "d2"
		case 4:
			notation = "d4"
		case 6:
			notation = "2d6+3"
		case 8:
			notation = "d8"
		case 10:
			notation = "d10-1"
		case 12:
			notation = "d12"
		case 20:
			notation = "1d20+5"
		case 100:
			notation = "d100"
		}
		for i := 0; i < 50; i++ {
			res, err := engine.RollDice(notation)
			if err != nil {
				t.Fatalf("RollDice(%q) error: %v", notation, err)
			}
			if res.Sides != sides {
				t.Fatalf("expected sides=%d, got %d", sides, res.Sides)
			}
			for _, r := range res.Rolls {
				if r < 1 || r > sides {
					t.Fatalf("roll %d out of range [1, %d]", r, sides)
				}
			}
			if res.Total != res.Subtotal+res.Modifier {
				t.Fatalf("total mismatch: got %d want %d+%d", res.Total, res.Subtotal, res.Modifier)
			}
		}
	}

	// Verify Nat 20 & Nat 1 detection over enough d20 rolls
	seenCrit := false
	seenFumble := false
	for i := 0; i < 500 && (!seenCrit || !seenFumble); i++ {
		res, err := engine.RollDice("1d20")
		if err != nil {
			t.Fatal(err)
		}
		if res.Rolls[0] == 20 {
			if !res.IsCritical || res.IsFumble {
				t.Fatalf("expected IsCritical=true on roll 20, got %+v", res)
			}
			seenCrit = true
		}
		if res.Rolls[0] == 1 {
			if !res.IsFumble || res.IsCritical {
				t.Fatalf("expected IsFumble=true on roll 1, got %+v", res)
			}
			seenFumble = true
		}
	}
	if !seenCrit || !seenFumble {
		t.Fatalf("expected to see both crit (%v) and fumble (%v) in 500 d20 rolls", seenCrit, seenFumble)
	}

	if _, err := engine.RollDice("invalid"); err == nil {
		t.Fatalf("expected error on invalid notation")
	}
}

func TestMagic8Ball(t *testing.T) {
	total, aff, neu, neg := engine.Magic8CatalogSize()
	if total != 20 || aff != 10 || neu != 5 || neg != 5 {
		t.Fatalf("expected 20 (10/5/5) answers, got %d (%d/%d/%d)", total, aff, neu, neg)
	}

	for i := 0; i < 40; i++ {
		res, err := engine.ShakeMagic8Ball(false, "¿Sobrevivirá el grupo?")
		if err != nil {
			t.Fatal(err)
		}
		if res.Answer == "" || res.StrictMode {
			t.Fatalf("unexpected classic 8-ball response: %+v", res)
		}
	}

	seenYes, seenNo := false, false
	for i := 0; i < 60; i++ {
		res, err := engine.ShakeMagic8Ball(true, "¿Abro el cofre?")
		if err != nil {
			t.Fatal(err)
		}
		if !res.StrictMode {
			t.Fatalf("expected StrictMode=true")
		}
		if res.Answer == "Sí" {
			seenYes = true
		} else if res.Answer == "No" {
			seenNo = true
		} else {
			t.Fatalf("unexpected strict answer: %q", res.Answer)
		}
	}
	if !seenYes || !seenNo {
		t.Fatalf("expected both Sí and No in strict mode")
	}
}

func TestSpinnerAndWheel(t *testing.T) {
	// Preset 6-face spinner
	res, err := engine.SpinTop(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Faces) != 6 || res.WinningIndex < 0 || res.WinningIndex >= 6 {
		t.Fatalf("unexpected preset spinner result: %+v", res)
	}

	// Invalid 3-face spinner should fail
	if _, err := engine.SpinTop([]string{"A", "B", "C"}); err == nil {
		t.Fatalf("expected error for < 4 faces")
	}
	// Invalid 13-face spinner should fail
	if _, err := engine.SpinTop([]string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"}); err == nil {
		t.Fatalf("expected error for > 12 faces")
	}

	// Custom 8-face spinner
	customFaces := []string{"N", "NE", "E", "SE", "S", "SO", "O", "NO"}
	res8, err := engine.SpinTop(customFaces)
	if err != nil {
		t.Fatal(err)
	}
	if res8.Label != customFaces[res8.WinningIndex] {
		t.Fatalf("label mismatch")
	}

	// Wheel validation
	if _, err := engine.SpinWheel([]string{"SoloUno"}); err == nil {
		t.Fatalf("expected error for < 2 wheel options")
	}
	wOpts := []string{"Atacar", "Huir", "Negociar"}
	wRes, err := engine.SpinWheel(wOpts)
	if err != nil {
		t.Fatal(err)
	}
	if wRes.Option != wOpts[wRes.WinningIndex] {
		t.Fatalf("wheel option mismatch")
	}
}

func TestTurnOrderAndTieBreaking(t *testing.T) {
	base := time.Date(2026, 11, 23, 15, 0, 0, 0, time.UTC)
	players := []engine.TurnPlayer{
		{ID: "p3", Name: "Legolas", Initiative: 15, CreatedAt: base.Add(20 * time.Second)},
		{ID: "p2", Name: "Gimli", Initiative: 15, CreatedAt: base.Add(10 * time.Second)},
		{ID: "p1", Name: "Thorin", Initiative: 20, CreatedAt: base.Add(30 * time.Second)},
		{ID: "p4", Name: "Frodo", Initiative: 8, CreatedAt: base.Add(5 * time.Second)},
	}
	sorted := engine.SortPlayersForTurnOrder(players)
	if sorted[0].ID != "p1" || sorted[1].ID != "p2" || sorted[2].ID != "p3" || sorted[3].ID != "p4" {
		t.Fatalf("unexpected sort order: %+v", sorted)
	}

	// Verify cyclic advance
	idx := engine.NextTurnIndex(3, 4)
	if idx != 0 {
		t.Fatalf("expected wrap to 0, got %d", idx)
	}
	prev := engine.PrevTurnIndex(0, 4)
	if prev != 3 {
		t.Fatalf("expected wrap back to 3, got %d", prev)
	}
}
