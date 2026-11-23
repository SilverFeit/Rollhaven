package engine

// Magic8Category classifies the Magic 8 Ball outcome tone.
type Magic8Category string

const (
	Magic8Affirmative Magic8Category = "AFFIRMATIVE"
	Magic8Neutral     Magic8Category = "NEUTRAL"
	Magic8Negative    Magic8Category = "NEGATIVE"
)

// Magic8Response holds a single Magic 8 Ball outcome.
type Magic8Response struct {
	Answer     string         `json:"answer"`
	Category   Magic8Category `json:"category"`
	StrictMode bool           `json:"strict_mode"`
	Question   string         `json:"question,omitempty"`
}

var magic8ClassicResponses = []struct {
	Answer   string
	Category Magic8Category
}{
	// 10 Afirmativas
	{"En mi opinión, sí", Magic8Affirmative},
	{"Es cierto", Magic8Affirmative},
	{"Es decididamente así", Magic8Affirmative},
	{"Probablemente", Magic8Affirmative},
	{"Todo apunta a que sí", Magic8Affirmative},
	{"Sin duda", Magic8Affirmative},
	{"Sí", Magic8Affirmative},
	{"Sí - definitivamente", Magic8Affirmative},
	{"Puedes confiar en ello", Magic8Affirmative},
	{"Perspectiva buena", Magic8Affirmative},
	// 5 Neutras / Dudosas
	{"Respuesta vaga, vuelve a intentarlo", Magic8Neutral},
	{"Pregunta de nuevo más tarde", Magic8Neutral},
	{"Mejor no decirte ahora", Magic8Neutral},
	{"No puedo predecirlo ahora", Magic8Neutral},
	{"Concéntrate y pregunta de nuevo", Magic8Neutral},
	// 5 Negativas
	{"No cuentes con ello", Magic8Negative},
	{"Mi respuesta es no", Magic8Negative},
	{"Mis fuentes dicen que no", Magic8Negative},
	{"Las perspectivas no son buenas", Magic8Negative},
	{"Muy dudoso", Magic8Negative},
}

// ShakeMagic8Ball picks either one of the 20 standard answers or a strict 50/50 Yes/No answer.
func ShakeMagic8Ball(strictYesNo bool, question string) (Magic8Response, error) {
	if strictYesNo {
		idx, err := CryptoRandInt(0, 1)
		if err != nil {
			return Magic8Response{}, err
		}
		if idx == 0 {
			return Magic8Response{
				Answer:     "Sí",
				Category:   Magic8Affirmative,
				StrictMode: true,
				Question:   question,
			}, nil
		}
		return Magic8Response{
			Answer:     "No",
			Category:   Magic8Negative,
			StrictMode: true,
			Question:   question,
		}, nil
	}

	idx, err := CryptoRandInt(0, len(magic8ClassicResponses)-1)
	if err != nil {
		return Magic8Response{}, err
	}
	choice := magic8ClassicResponses[idx]
	return Magic8Response{
		Answer:     choice.Answer,
		Category:   choice.Category,
		StrictMode: false,
		Question:   question,
	}, nil
}

// Magic8CatalogSize exposes the standard 20-answer count for verification tests.
func Magic8CatalogSize() (total, affirmative, neutral, negative int) {
	for _, r := range magic8ClassicResponses {
		total++
		switch r.Category {
		case Magic8Affirmative:
			affirmative++
		case Magic8Neutral:
			neutral++
		case Magic8Negative:
			negative++
		}
	}
	return
}
