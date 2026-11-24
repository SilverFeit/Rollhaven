package compendium

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSQLiteSeedAndQueries(t *testing.T) {
	repo, err := Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open memory compendium: %v", err)
	}
	defer repo.Close()

	st := repo.HealthCheck()
	if !st.Connected || st.Driver != "sqlite" {
		t.Fatalf("expected connected sqlite status, got %+v", st)
	}
	if st.Counts[CategorySpecies] == 0 || st.Counts[CategoryClasses] == 0 || st.Counts[CategoryBackgrounds] == 0 {
		t.Fatalf("expected seeded synthetic demo counts, got %+v", st.Counts)
	}

	bgs, err := repo.ListEntries(CategoryBackgrounds, ListFilter{})
	if err != nil || len(bgs) == 0 {
		t.Fatalf("list backgrounds failed: %v", err)
	}
	env, err := repo.GetEntry(CategoryBackgrounds, bgs[0].Slug)
	if err != nil {
		t.Fatalf("get background failed: %v", err)
	}
	if len(env.Links) == 0 {
		t.Fatalf("expected graph link from 2024 background to origin feat")
	}

	spells, err := repo.ListEntries(CategorySpells, ListFilter{Query: "Esfera"})
	if err != nil || len(spells) != 1 {
		t.Fatalf("expected 1 filtered spell, got %d (err=%v)", len(spells), err)
	}
}

func TestObsidianVaultIngestion(t *testing.T) {
	tmp := t.TempDir()
	notePath := filepath.Join(tmp, "Trasfondo Custom.md")
	content := `---
type: background
name: Explorador Estelar
ruleset_version: "2024"
ability_options: [DES, INT, SAB]
origin_feat: Dote Estelar
skill_proficiencies: [Supervivencia, Naturaleza]
starting_gold: 20
---
Trasfondo conectado con [[Dote Estelar]] para navegación nocturna.`

	if err := os.WriteFile(notePath, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp obsidian note: %v", err)
	}

	repo, err := Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open memory compendium: %v", err)
	}
	defer repo.Close()

	imported, err := repo.ImportFromPath(tmp)
	if err != nil {
		t.Fatalf("import obsidian vault: %v", err)
	}
	if imported != 1 {
		t.Fatalf("expected 1 imported entry, got %d", imported)
	}

	env, err := repo.GetEntry(CategoryBackgrounds, "explorador-estelar")
	if err != nil {
		t.Fatalf("lookup imported background: %v", err)
	}
	if env.Name != "Explorador Estelar" || len(env.Links) == 0 {
		t.Fatalf("unexpected imported entry or links: %+v", env)
	}
}
