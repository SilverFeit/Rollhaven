package engine

import (
	"sort"
	"time"
)

// TurnPlayer represents the turn-relevant fields of a player in the initiative order.
type TurnPlayer struct {
	ID          string
	Name        string
	Initiative  int
	TurnOrder   int
	ManualOrder bool
	CreatedAt   time.Time
}

// SortPlayersForTurnOrder orders players descending by Initiative, breaking ties deterministically
// by CreatedAt ascending (and ID ascending as final tie-breaker).
// If any player has ManualOrder enabled (from DM drag-and-drop), it sorts by TurnOrder ascending first.
func SortPlayersForTurnOrder(players []TurnPlayer) []TurnPlayer {
	ordered := make([]TurnPlayer, len(players))
	copy(ordered, players)

	useManual := false
	for _, p := range ordered {
		if p.ManualOrder {
			useManual = true
			break
		}
	}

	sort.SliceStable(ordered, func(i, j int) bool {
		a, b := ordered[i], ordered[j]
		if useManual {
			if a.ManualOrder && b.ManualOrder && a.TurnOrder != b.TurnOrder {
				return a.TurnOrder < b.TurnOrder
			}
			if a.ManualOrder != b.ManualOrder {
				return a.ManualOrder
			}
		}
		if a.Initiative != b.Initiative {
			return a.Initiative > b.Initiative
		}
		if !a.CreatedAt.Equal(b.CreatedAt) {
			return a.CreatedAt.Before(b.CreatedAt)
		}
		return a.ID < b.ID
	})

	return ordered
}

// NextTurnIndex advances the active turn index cyclically across N players.
func NextTurnIndex(currentIndex, totalPlayers int) int {
	if totalPlayers <= 0 {
		return 0
	}
	if currentIndex < 0 {
		currentIndex = 0
	}
	return (currentIndex + 1) % totalPlayers
}

// PrevTurnIndex steps backward cyclically across N players.
func PrevTurnIndex(currentIndex, totalPlayers int) int {
	if totalPlayers <= 0 {
		return 0
	}
	if currentIndex < 0 {
		currentIndex = 0
	}
	return (currentIndex - 1 + totalPlayers) % totalPlayers
}
