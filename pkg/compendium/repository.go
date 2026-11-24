package compendium

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// CompendiumRepository defines the storage-agnostic contract for querying and importing D&D 2024 compendium data.
type CompendiumRepository interface {
	HealthCheck() CompendiumStatus
	ListEntries(category string, filter ListFilter) ([]EntryEnvelope, error)
	GetEntry(category, slug string) (EntryEnvelope, error)
	ImportBundle(bundle CompendiumBundle) (int, error)
	Close() error
}

// ListFilter filters compendium entries across REST and wizard queries.
type ListFilter struct {
	Query       string
	Ruleset     string
	ClassSlug   string
	SubCategory string
	Level       *int
}

// SQLRepository implements CompendiumRepository on top of SQLite (default) or PostgreSQL (DietPi).
type SQLRepository struct {
	db       *sql.DB
	driver   string
	dsn      string
	initErr  string
	isPg     bool
}

// Open opens a compendium repository using driver ("sqlite" or "postgres") and dsn.
// If postgres is requested without an active driver/server, it retains a degraded status instead of crashing Rollhaven.
func Open(driver, dsn string) (*SQLRepository, error) {
	drv := strings.ToLower(strings.TrimSpace(driver))
	if drv == "" {
		drv = "sqlite"
	}

	repo := &SQLRepository{
		driver: drv,
		dsn:    dsn,
		isPg:   drv == "postgres" || drv == "pgx",
	}

	if repo.isPg {
		if strings.TrimSpace(dsn) == "" {
			repo.initErr = "PostgreSQL configurado sin DSN (-compendium-dsn)"
			return repo, nil
		}
		sqlDrv := "pgx"
		if drv == "postgres" {
			// Try standard postgres driver names registered in database/sql
			if !hasSQLDriver("pgx") && hasSQLDriver("postgres") {
				sqlDrv = "postgres"
			}
		}
		if !hasSQLDriver(sqlDrv) {
			repo.initErr = fmt.Sprintf("Driver SQL '%s' no compilado en este binario; usa SQLite para pruebas o enlaza pgx al desplegar en DietPi", sqlDrv)
			return repo, nil
		}
		db, err := sql.Open(sqlDrv, dsn)
		if err != nil {
			repo.initErr = err.Error()
			return repo, nil
		}
		if err := db.Ping(); err != nil {
			_ = db.Close()
			repo.initErr = err.Error()
			return repo, nil
		}
		repo.db = db
		if err := repo.applySchema(); err != nil {
			repo.initErr = err.Error()
		}
		return repo, nil
	}

	// Default SQLite driver (pure-Go modernc.org/sqlite)
	sqliteDSN := dsn
	if strings.TrimSpace(sqliteDSN) == "" {
		sqliteDSN = ":memory:"
	}
	if sqliteDSN != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(sqliteDSN), 0o755); err != nil {
			return nil, fmt.Errorf("create compendium dir: %w", err)
		}
		sqliteDSN = fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", sqliteDSN)
	}

	db, err := sql.Open("sqlite", sqliteDSN)
	if err != nil {
		return nil, fmt.Errorf("open sqlite compendium: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite compendium: %w", err)
	}
	repo.db = db
	if err := repo.applySchema(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply compendium schema: %w", err)
	}
	if err := repo.SeedSyntheticDemoDataIfEmpty(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("seed synthetic demo compendium: %w", err)
	}
	return repo, nil
}

func hasSQLDriver(name string) bool {
	for _, d := range sql.Drivers() {
		if d == name {
			return true
		}
	}
	return false
}

// Close closes the underlying database connection if open.
func (r *SQLRepository) Close() error {
	if r.db != nil {
		return r.db.Close()
	}
	return nil
}

func (r *SQLRepository) rebind(query string) string {
	if !r.isPg {
		return query
	}
	var out strings.Builder
	idx := 1
	for i := 0; i < len(query); i++ {
		if query[i] == '?' {
			fmt.Fprintf(&out, "$%d", idx)
			idx++
		} else {
			out.WriteByte(query[i])
		}
	}
	return out.String()
}

func (r *SQLRepository) applySchema() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS compendium_entries (
			category TEXT NOT NULL,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			ruleset_version TEXT NOT NULL DEFAULT '2024',
			level_num INTEGER NOT NULL DEFAULT 0,
			sub_category TEXT NOT NULL DEFAULT '',
			classes_csv TEXT NOT NULL DEFAULT '',
			data_json TEXT NOT NULL,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (category, slug)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_compendium_cat_name ON compendium_entries(category, name)`,
		`CREATE TABLE IF NOT EXISTS compendium_links (
			from_type TEXT NOT NULL,
			from_slug TEXT NOT NULL,
			to_type TEXT NOT NULL,
			to_slug TEXT NOT NULL,
			relation TEXT NOT NULL DEFAULT 'references',
			PRIMARY KEY (from_type, from_slug, to_type, to_slug, relation)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_compendium_links_from ON compendium_links(from_type, from_slug)`,
	}
	for _, s := range stmts {
		if _, err := r.db.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

// HealthCheck reports active driver, connection status, and counts per compendium category.
func (r *SQLRepository) HealthCheck() CompendiumStatus {
	st := CompendiumStatus{
		Driver:  r.driver,
		Ruleset: "2024",
		Counts:  make(map[string]int),
	}
	if r.db == nil || r.initErr != "" {
		st.Connected = false
		st.Error = r.initErr
		return st
	}
	if err := r.db.Ping(); err != nil {
		st.Connected = false
		st.Error = err.Error()
		return st
	}
	st.Connected = true
	rows, err := r.db.Query(`SELECT category, COUNT(*) FROM compendium_entries GROUP BY category`)
	if err != nil {
		st.Error = err.Error()
		return st
	}
	defer rows.Close()
	for rows.Next() {
		var cat string
		var cnt int
		if err := rows.Scan(&cat, &cnt); err == nil {
			st.Counts[cat] = cnt
		}
	}
	return st
}

// UpsertEntry stores or updates a single typed compendium record cleanly across SQLite and PostgreSQL.
func (r *SQLRepository) UpsertEntry(category, slug, name, ruleset string, level int, subCat string, classes []string, data any) error {
	if r.db == nil {
		return fmt.Errorf("compendium database not connected: %s", r.initErr)
	}
	category = normalizeCategory(category)
	slug = Slugify(slug)
	if slug == "" {
		slug = Slugify(name)
	}
	if slug == "" || strings.TrimSpace(name) == "" {
		return fmt.Errorf("slug and name are required")
	}
	if strings.TrimSpace(ruleset) == "" {
		ruleset = "2024"
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	classesCSV := "," + strings.ToLower(strings.Join(classes, ",")) + ","

	q := r.rebind(`
		INSERT INTO compendium_entries (category, slug, name, ruleset_version, level_num, sub_category, classes_csv, data_json, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (category, slug) DO UPDATE SET
			name = excluded.name,
			ruleset_version = excluded.ruleset_version,
			level_num = excluded.level_num,
			sub_category = excluded.sub_category,
			classes_csv = excluded.classes_csv,
			data_json = excluded.data_json,
			updated_at = excluded.updated_at
	`)
	_, err = r.db.Exec(q, category, slug, strings.TrimSpace(name), ruleset, level, strings.ToLower(strings.TrimSpace(subCat)), classesCSV, string(raw), time.Now().UTC())
	return err
}

// UpsertLink records a directional graph edge between two compendium entries.
func (r *SQLRepository) UpsertLink(link CompendiumLink) error {
	if r.db == nil {
		return fmt.Errorf("compendium database not connected")
	}
	rel := strings.TrimSpace(link.Relation)
	if rel == "" {
		rel = "references"
	}
	q := r.rebind(`
		INSERT INTO compendium_links (from_type, from_slug, to_type, to_slug, relation)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (from_type, from_slug, to_type, to_slug, relation) DO NOTHING
	`)
	_, err := r.db.Exec(q, normalizeCategory(link.FromType), Slugify(link.FromSlug), normalizeCategory(link.ToType), Slugify(link.ToSlug), rel)
	return err
}

// ImportBundle inserts or updates all entities and graph links inside a CompendiumBundle.
func (r *SQLRepository) ImportBundle(bundle CompendiumBundle) (int, error) {
	if r.db == nil {
		return 0, fmt.Errorf("compendium database not connected: %s", r.initErr)
	}
	defRuleset := strings.TrimSpace(bundle.RulesetVersion)
	if defRuleset == "" {
		defRuleset = "2024"
	}
	count := 0
	pickRuleset := func(v string) string {
		if strings.TrimSpace(v) != "" {
			return v
		}
		return defRuleset
	}

	for _, sp := range bundle.Species {
		sp.RulesetVersion = pickRuleset(sp.RulesetVersion)
		if sp.Slug == "" {
			sp.Slug = Slugify(sp.Name)
		}
		if err := r.UpsertEntry(CategorySpecies, sp.Slug, sp.Name, sp.RulesetVersion, 0, sp.Size, nil, sp); err != nil {
			return count, err
		}
		count++
	}
	for _, cl := range bundle.Classes {
		cl.RulesetVersion = pickRuleset(cl.RulesetVersion)
		if cl.Slug == "" {
			cl.Slug = Slugify(cl.Name)
		}
		if err := r.UpsertEntry(CategoryClasses, cl.Slug, cl.Name, cl.RulesetVersion, 0, cl.SpellcastingAbility, nil, cl); err != nil {
			return count, err
		}
		count++
	}
	for _, sc := range bundle.Subclasses {
		sc.RulesetVersion = pickRuleset(sc.RulesetVersion)
		if sc.Slug == "" {
			sc.Slug = Slugify(sc.Name)
		}
		if err := r.UpsertEntry(CategorySubclasses, sc.Slug, sc.Name, sc.RulesetVersion, sc.LevelGranted, sc.ClassSlug, []string{sc.ClassSlug}, sc); err != nil {
			return count, err
		}
		_ = r.UpsertLink(CompendiumLink{FromType: CategorySubclasses, FromSlug: sc.Slug, ToType: CategoryClasses, ToSlug: sc.ClassSlug, Relation: "subclass_of"})
		count++
	}
	for _, bg := range bundle.Backgrounds {
		bg.RulesetVersion = pickRuleset(bg.RulesetVersion)
		if bg.Slug == "" {
			bg.Slug = Slugify(bg.Name)
		}
		if err := r.UpsertEntry(CategoryBackgrounds, bg.Slug, bg.Name, bg.RulesetVersion, 0, bg.OriginFeatSlug, nil, bg); err != nil {
			return count, err
		}
		if bg.OriginFeatSlug != "" {
			_ = r.UpsertLink(CompendiumLink{FromType: CategoryBackgrounds, FromSlug: bg.Slug, ToType: CategoryFeats, ToSlug: bg.OriginFeatSlug, Relation: "grants_origin_feat"})
		}
		count++
	}
	for _, ft := range bundle.Feats {
		ft.RulesetVersion = pickRuleset(ft.RulesetVersion)
		if ft.Slug == "" {
			ft.Slug = Slugify(ft.Name)
		}
		if err := r.UpsertEntry(CategoryFeats, ft.Slug, ft.Name, ft.RulesetVersion, 0, ft.Category, nil, ft); err != nil {
			return count, err
		}
		count++
	}
	for _, feat := range bundle.Features {
		feat.RulesetVersion = pickRuleset(feat.RulesetVersion)
		if feat.Slug == "" {
			feat.Slug = Slugify(feat.Name)
		}
		if err := r.UpsertEntry(CategoryFeatures, feat.Slug, feat.Name, feat.RulesetVersion, feat.Level, feat.SourceType, []string{feat.SourceSlug}, feat); err != nil {
			return count, err
		}
		count++
	}
	for _, it := range bundle.Items {
		it.RulesetVersion = pickRuleset(it.RulesetVersion)
		if it.Slug == "" {
			it.Slug = Slugify(it.Name)
		}
		if err := r.UpsertEntry(CategoryItems, it.Slug, it.Name, it.RulesetVersion, 0, it.Category, nil, it); err != nil {
			return count, err
		}
		count++
	}
	for _, sp := range bundle.Spells {
		sp.RulesetVersion = pickRuleset(sp.RulesetVersion)
		if sp.Slug == "" {
			sp.Slug = Slugify(sp.Name)
		}
		if err := r.UpsertEntry(CategorySpells, sp.Slug, sp.Name, sp.RulesetVersion, sp.Level, sp.School, sp.Classes, sp); err != nil {
			return count, err
		}
		for _, cSlug := range sp.Classes {
			_ = r.UpsertLink(CompendiumLink{FromType: CategorySpells, FromSlug: sp.Slug, ToType: CategoryClasses, ToSlug: cSlug, Relation: "available_to"})
		}
		count++
	}
	for _, m := range bundle.Monsters {
		m.RulesetVersion = pickRuleset(m.RulesetVersion)
		if m.Slug == "" {
			m.Slug = Slugify(m.Name)
		}
		if err := r.UpsertEntry(CategoryMonsters, m.Slug, m.Name, m.RulesetVersion, int(m.CRNumeric), m.CreatureType, nil, m); err != nil {
			return count, err
		}
		count++
	}
	for _, l := range bundle.Links {
		_ = r.UpsertLink(l)
	}
	return count, nil
}

// ListEntries queries entries in a category with search, ruleset, class, subcategory, and level filters.
func (r *SQLRepository) ListEntries(category string, filter ListFilter) ([]EntryEnvelope, error) {
	if r.db == nil {
		return []EntryEnvelope{}, fmt.Errorf("compendium database not connected: %s", r.initErr)
	}
	cat := normalizeCategory(category)
	var clauses []string
	var args []any
	clauses = append(clauses, "category = ?")
	args = append(args, cat)

	if q := strings.TrimSpace(filter.Query); q != "" {
		clauses = append(clauses, "(LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(data_json) LIKE ?)")
		pat := "%" + strings.ToLower(q) + "%"
		args = append(args, pat, pat, pat)
	}
	if rs := strings.TrimSpace(filter.Ruleset); rs != "" {
		clauses = append(clauses, "ruleset_version = ?")
		args = append(args, rs)
	}
	if sc := strings.TrimSpace(filter.SubCategory); sc != "" {
		clauses = append(clauses, "sub_category = ?")
		args = append(args, strings.ToLower(sc))
	}
	if cs := strings.TrimSpace(filter.ClassSlug); cs != "" {
		clauses = append(clauses, "classes_csv LIKE ?")
		args = append(args, "%,"+strings.ToLower(Slugify(cs))+",%")
	}
	if filter.Level != nil {
		clauses = append(clauses, "level_num = ?")
		args = append(args, *filter.Level)
	}

	sqlQuery := fmt.Sprintf(`
		SELECT category, slug, name, ruleset_version, level_num, sub_category, data_json, updated_at
		FROM compendium_entries
		WHERE %s
		ORDER BY level_num ASC, name ASC
	`, strings.Join(clauses, " AND "))

	rows, err := r.db.Query(r.rebind(sqlQuery), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EntryEnvelope
	for rows.Next() {
		var env EntryEnvelope
		var rawJSON string
		if err := rows.Scan(&env.Category, &env.Slug, &env.Name, &env.RulesetVersion, &env.Level, &env.SubCategory, &rawJSON, &env.UpdatedAt); err != nil {
			return nil, err
		}
		var parsed any
		_ = json.Unmarshal([]byte(rawJSON), &parsed)
		env.Data = parsed
		out = append(out, env)
	}
	if out == nil {
		out = []EntryEnvelope{}
	}
	return out, rows.Err()
}

// GetEntry returns one compendium entry along with resolved graph links (dnd5eapi/Obsidian style).
func (r *SQLRepository) GetEntry(category, slug string) (EntryEnvelope, error) {
	if r.db == nil {
		return EntryEnvelope{}, fmt.Errorf("compendium database not connected: %s", r.initErr)
	}
	cat := normalizeCategory(category)
	cleanSlug := Slugify(slug)
	var env EntryEnvelope
	var rawJSON string
	err := r.db.QueryRow(r.rebind(`
		SELECT category, slug, name, ruleset_version, level_num, sub_category, data_json, updated_at
		FROM compendium_entries WHERE category = ? AND slug = ?
	`), cat, cleanSlug).Scan(&env.Category, &env.Slug, &env.Name, &env.RulesetVersion, &env.Level, &env.SubCategory, &rawJSON, &env.UpdatedAt)
	if err != nil {
		return EntryEnvelope{}, err
	}
	var parsed any
	_ = json.Unmarshal([]byte(rawJSON), &parsed)
	env.Data = parsed

	linkRows, err := r.db.Query(r.rebind(`
		SELECT l.to_type, l.to_slug, COALESCE(e.name, l.to_slug)
		FROM compendium_links l
		LEFT JOIN compendium_entries e ON e.category = l.to_type AND e.slug = l.to_slug
		WHERE l.from_type = ? AND l.from_slug = ?
	`), cat, cleanSlug)
	if err == nil {
		defer linkRows.Close()
		for linkRows.Next() {
			var toType, toSlug, toName string
			if err := linkRows.Scan(&toType, &toSlug, &toName); err == nil {
				env.Links = append(env.Links, CompendiumRef{
					Index: toSlug,
					Name:  toName,
					Type:  toType,
					URL:   fmt.Sprintf("/api/v1/compendium/%s/%s", toType, toSlug),
				})
			}
		}
	}
	return env, nil
}

// SeedSyntheticDemoDataIfEmpty populates purely synthetic, copyright-free D&D 2024 test fixtures
// so local SQLite development, tests, and UI flows work without including any copyrighted rulebook text.
func (r *SQLRepository) SeedSyntheticDemoDataIfEmpty() error {
	var total int
	if err := r.db.QueryRow(`SELECT COUNT(*) FROM compendium_entries`).Scan(&total); err != nil {
		return err
	}
	if total > 0 {
		return nil
	}

	demoBundle := CompendiumBundle{
		RulesetVersion: "2024",
		Species: []Species{
			{
				Slug: "demo-caminante-solar", Name: "Caminante Solar (Demo)", CreatureType: "Humanoide", Size: "Mediano", Speed: 30,
				Languages: []string{"Común", "Celestial"},
				Traits: []FeatureBrief{
					{Slug: "luz-interior", Name: "Luz Interior", Description: "Emite luz tenue en 10 pies y resiste daño radiante (fixture sintético 2024)."},
				},
				Description: "Especie de prueba sintética 2024 (sin ASI fijo en especie; los bonos provienen del Background).",
			},
			{
				Slug: "demo-forjado-valle", Name: "Forjado del Valle (Demo)", CreatureType: "Humanoide", Size: "Mediano", Speed: 30,
				Languages: []string{"Común", "Enano"},
				Traits: []FeatureBrief{
					{Slug: "temple-mineral", Name: "Temple Mineral", Description: "Ventaja en salvaciones contra veneno y resistencia al veneno."},
				},
				Description: "Especie robusta de prueba para el wizard D&D 2024.",
			},
			{
				Slug: "demo-sombra-bosque", Name: "Brisa del Bosque (Demo)", CreatureType: "Feérico", Size: "Mediano", Speed: 35,
				Languages: []string{"Común", "Silvano"},
				Traits: []FeatureBrief{
					{Slug: "paso-ligero", Name: "Paso Ligero", Description: "Velocidad base de 35 pies y visión en la oscuridad 60 pies."},
				},
				Description: "Especie ágil de prueba para exploradores y lanzadores.",
			},
		},
		Feats: []Feat{
			{
				Slug: "demo-alerta-origen", Name: "Instinto de Vanguardia (Origin Feat Demo)", Category: "ORIGIN", Repeatable: false,
				Benefits:    []string{"Suma tu Bono de Competencia a las tiradas de Iniciativa."},
				Description: "Dote de origen sintética de prueba (reglas 2024).",
			},
			{
				Slug: "demo-iniciado-arcano", Name: "Chispa Arcana (Origin Feat Demo)", Category: "ORIGIN", Repeatable: true,
				Benefits:    []string{"Conoces un truco ofensivo y un conjuro de nivel 1."},
				Description: "Dote de origen mágica de prueba.",
			},
		},
		Backgrounds: []Background{
			{
				Slug: "demo-centinela-frontera", Name: "Centinela de Frontera (Demo)",
				AbilityOptions:     []string{"FUE", "DES", "CON"},
				OriginFeatSlug:     "demo-alerta-origen",
				OriginFeatName:     "Instinto de Vanguardia (Origin Feat Demo)",
				SkillProficiencies: []string{"Percepción", "Atletismo"},
				ToolProficiency:    "Kit de Cartógrafo",
				StartingEquipment:  []string{"demo-hoja-acero", "demo-escudo-roble"},
				StartingGold:       15,
				Description:        "Background 2024 de prueba: elige +2/+1 o +1/+1/+1 entre FUE, DES y CON.",
			},
			{
				Slug: "demo-erudito-archivo", Name: "Erudito de Archivo (Demo)",
				AbilityOptions:     []string{"INT", "SAB", "CAR"},
				OriginFeatSlug:     "demo-iniciado-arcano",
				OriginFeatName:     "Chispa Arcana (Origin Feat Demo)",
				SkillProficiencies: []string{"Arcanos", "Investigación"},
				ToolProficiency:    "Útiles de Calígrafo",
				StartingEquipment:  []string{"demo-baston-runico", "demo-pocion-vital"},
				StartingGold:       25,
				Description:        "Background 2024 de prueba para conjuros: elige +2/+1 o +1/+1/+1 entre INT, SAB y CAR.",
			},
		},
		Classes: []Class{
			{
				Slug: "demo-guardian", Name: "Guardián Marcial (Demo)", HitDie: 10,
				PrimaryAbilities: []string{"FUE", "CON"}, SavingThrows: []string{"FUE", "CON"},
				SkillChoicesCount: 2, SkillOptions: []string{"Atletismo", "Percepción", "Intimidación", "Supervivencia"},
				ArmorProficiencies: []string{"Ligeras", "Medias", "Pesadas", "Escudos"}, WeaponProficiencies: []string{"Simples", "Marciales"},
				WeaponMasteriesCount: 3,
				Features: []FeatureBrief{
					{Slug: "demo-aliento-marcial", Name: "Aliento Marcial", Level: 1, Description: "Recupera 1d10 + Nivel HP como acción adicional.", Formula: "1d10+1"},
					{Slug: "demo-maestria-arma", Name: "Maestría en Armas (2024)", Level: 1, Description: "Activa propiedades Cleave/Push/Vex/Topple con armas equipadas."},
				},
				Description: "Clase marcial sintética para validar el creador 2024.",
			},
			{
				Slug: "demo-arcanista", Name: "Arcanista de Éter (Demo)", HitDie: 6,
				PrimaryAbilities: []string{"INT"}, SavingThrows: []string{"INT", "SAB"},
				SkillChoicesCount: 2, SkillOptions: []string{"Arcanos", "Historia", "Investigación", "Perspicacia"},
				ArmorProficiencies: []string{}, WeaponProficiencies: []string{"Simples"},
				WeaponMasteriesCount: 0, SpellcastingAbility: "INT",
				Features: []FeatureBrief{
					{Slug: "demo-eco-arcano", Name: "Eco Arcano", Level: 1, Description: "Recupera un espacio de conjuro en descanso corto."},
				},
				Description: "Clase lanzadora sintética con soporte completo de conjuros AoE y salvación.",
			},
			{
				Slug: "demo-acechador", Name: "Acechador Sombrío (Demo)", HitDie: 8,
				PrimaryAbilities: []string{"DES"}, SavingThrows: []string{"DES", "INT"},
				SkillChoicesCount: 4, SkillOptions: []string{"Sigilo", "Acrobacias", "Percepción", "Juego de Manos", "Engaño"},
				ArmorProficiencies: []string{"Ligeras"}, WeaponProficiencies: []string{"Simples", "Finesse"},
				WeaponMasteriesCount: 2,
				Features: []FeatureBrief{
					{Slug: "demo-golpe-preciso", Name: "Golpe Preciso", Level: 1, Description: "Añade daño extra si atacas con ventaja o aliado cercano.", Formula: "1d6"},
				},
				Description: "Clase ágil sintética para pruebas de Finesse y Weapon Mastery.",
			},
		},
		Items: []Item{
			{
				Slug: "demo-hoja-acero", Name: "Espada Larga de Prueba", Category: "weapon",
				DamageFormula: "1d8", DamageType: "Cortante", Properties: []string{"Versátil (1d10)"}, WeaponMastery: "Sap",
				CostGP: 15, WeightLB: 3, Description: "Arma marcial cuerpo a cuerpo con maestría Sap (2024).",
			},
			{
				Slug: "demo-daga-veloz", Name: "Daga Veloz de Prueba", Category: "weapon",
				DamageFormula: "1d4", DamageType: "Perforante", Properties: []string{"Finesse", "Light", "Thrown"}, WeaponMastery: "Nick", RangeFt: "20/60",
				CostGP: 2, WeightLB: 1, Description: "Arma ligera con Finesse y maestría Nick (2024).",
			},
			{
				Slug: "demo-arco-cazador", Name: "Arco Corto de Prueba", Category: "weapon",
				DamageFormula: "1d6", DamageType: "Perforante", Properties: []string{"Ammunition", "Two-Handed"}, WeaponMastery: "Vex", RangeFt: "80/320",
				CostGP: 25, WeightLB: 2, Description: "Arma a distancia con maestría Vex.",
			},
			{
				Slug: "demo-baston-runico", Name: "Bastón Rúnico de Prueba", Category: "weapon",
				DamageFormula: "1d6", DamageType: "Contundente", Properties: []string{"Versátil (1d8)"}, WeaponMastery: "Topple",
				CostGP: 5, WeightLB: 4, Description: "Bastón simple con maestría Topple.",
			},
			{
				Slug: "demo-cota-escamas", Name: "Cota de Escamas de Prueba", Category: "armor",
				ArmorClassBase: 14, ArmorDexBonus: "max2", CostGP: 50, WeightLB: 45,
				Description: "Armadura media: CA 14 + DES (máx. +2).",
			},
			{
				Slug: "demo-armadura-cuero", Name: "Cuero Tachonado de Prueba", Category: "armor",
				ArmorClassBase: 12, ArmorDexBonus: "full", CostGP: 45, WeightLB: 13,
				Description: "Armadura ligera: CA 12 + DES completo.",
			},
			{
				Slug: "demo-escudo-roble", Name: "Escudo de Roble de Prueba", Category: "shield",
				ArmorClassBase: 2, ArmorDexBonus: "none", CostGP: 10, WeightLB: 6,
				Description: "+2 a la Clase de Armadura mientras está equipado.",
			},
			{
				Slug: "demo-pocion-vital", Name: "Poción Vital (Demo)", Category: "consumable",
				DamageFormula: "2d4+2", DamageType: "Curación", Rarity: "Común", CostGP: 50,
				Description: "Restaura 2d4+2 puntos de golpe.",
			},
		},
		Spells: []Spell{
			{
				Slug: "demo-esfera-ignea", Name: "Fireball / Esfera Ígnea (Demo)", Level: 3, School: "Evocación",
				CastingTime: "1 Acción", RangeFt: "150 pies", Components: "V, S, M", Duration: "Instantánea",
				SaveAbility: "DES", DamageFormula: "8d6", DamageType: "Fuego", AoEShape: "sphere", AoESizeFt: 20,
				Classes:     []string{"demo-arcanista"},
				Description: "Explosión ígnea de 20 pies de radio: Salvación DES (mitad en éxito), 8d6 daño de fuego.",
			},
			{
				Slug: "demo-dardo-eter", Name: "Dardo de Éter (Truco Demo)", Level: 0, School: "Evocación",
				CastingTime: "1 Acción", RangeFt: "120 pies", Components: "V, S", Duration: "Instantánea",
				AttackType: "ranged", DamageFormula: "1d10", DamageType: "Fuerza",
				Classes:     []string{"demo-arcanista"},
				Description: "Truco de ataque mágico a distancia (1d10 daño de fuerza).",
			},
			{
				Slug: "demo-pulso-sanador", Name: "Pulso Sanador (Demo)", Level: 1, School: "Abjuración",
				CastingTime: "1 Acción Adicional", RangeFt: "60 pies", Components: "V", Duration: "Instantánea",
				HealFormula: "1d4+3", Classes: []string{"demo-arcanista"},
				Description: "Restaura energía vital a un aliado a distancia.",
			},
		},
		Monsters: []Monster{
			{
				Slug: "demo-acechador-caverna", Name: "Acechador de Caverna (Demo)", Size: "Pequeño", GridSize: 1,
				CreatureType: "Humanoide", CR: "1/4", CRNumeric: 0.25, XP: 50, AC: 15, HP: 10, HitDice: "2d6+3",
				Speed: "30 ft", InitiativeBonus: 2,
				Abilities: map[string]int{"FUE": 8, "DES": 14, "CON": 12, "INT": 10, "SAB": 10, "CAR": 8},
				Saves:     map[string]int{"DES": 4, "CON": 1},
				Actions: []MonsterAction{
					{Name: "Cimitarra Oxidada", Kind: "attack", AttackBonus: 4, ReachOrRange: "5 ft", DamageFormula: "1d6+2", DamageType: "Cortante", Description: "+4 al ataque, 1d6+2 cortante."},
					{Name: "Arco Corto", Kind: "attack", AttackBonus: 4, ReachOrRange: "80/320 ft", DamageFormula: "1d6+2", DamageType: "Perforante", Description: "+4 al ataque, 1d6+2 perforante."},
				},
				Description: "Criatura ágil de prueba para encuentros de nivel bajo.",
			},
			{
				Slug: "demo-bruto-piedra", Name: "Bruto de Piedra (Demo)", Size: "Grande", GridSize: 2,
				CreatureType: "Gigante", CR: "2", CRNumeric: 2, XP: 450, AC: 13, HP: 59, HitDice: "7d10+21",
				Speed: "40 ft", InitiativeBonus: 0,
				Abilities: map[string]int{"FUE": 19, "DES": 8, "CON": 16, "INT": 6, "SAB": 8, "CAR": 7},
				Saves:     map[string]int{"FUE": 6, "CON": 5},
				Actions: []MonsterAction{
					{Name: "Maza Colosal", Kind: "attack", AttackBonus: 6, ReachOrRange: "5 ft", DamageFormula: "2d8+4", DamageType: "Contundente", Description: "+6 al ataque, 2d8+4 contundente."},
					{Name: "Onda Sísmica", Kind: "save", SaveAbility: "FUE", SaveDC: 13, DamageFormula: "2d6", DamageType: "Contundente", Description: "Salvación FUE CD 13 o derribado y 2d6 daño."},
				},
				Description: "Enemigo grande 2x2 de prueba.",
			},
			{
				Slug: "demo-draco-ceniza", Name: "Draco de Ceniza (Demo)", Size: "Grande", GridSize: 2,
				CreatureType: "Dragón", CR: "5", CRNumeric: 5, XP: 1800, AC: 17, HP: 95, HitDice: "10d10+40",
				Speed: "30 ft, Vuelo 60 ft", InitiativeBonus: 3,
				Abilities: map[string]int{"FUE": 18, "DES": 12, "CON": 18, "INT": 12, "SAB": 12, "CAR": 14},
				Saves:     map[string]int{"DES": 4, "CON": 7, "SAB": 4},
				Actions: []MonsterAction{
					{Name: "Mordisco Ígneo", Kind: "attack", AttackBonus: 7, ReachOrRange: "10 ft", DamageFormula: "2d10+4", DamageType: "Perforante", Description: "+7 al ataque, 2d10+4 perforante."},
					{Name: "Aliento de Brasas", Kind: "save", SaveAbility: "DES", SaveDC: 15, DamageFormula: "6d6", DamageType: "Fuego", Description: "Cono 30 ft: Salvación DES CD 15, 6d6 fuego (mitad si supera)."},
				},
				Description: "Jefe dragón sintético de prueba con acción de aliento con CD.",
			},
		},
	}

	_, err := r.ImportBundle(demoBundle)
	return err
}

func normalizeCategory(cat string) string {
	c := strings.ToLower(strings.TrimSpace(cat))
	switch c {
	case "race", "races":
		return CategorySpecies
	case "class":
		return CategoryClasses
	case "subclass":
		return CategorySubclasses
	case "background":
		return CategoryBackgrounds
	case "feat":
		return CategoryFeats
	case "feature":
		return CategoryFeatures
	case "item", "equipment":
		return CategoryItems
	case "spell":
		return CategorySpells
	case "monster":
		return CategoryMonsters
	default:
		return c
	}
}

// Slugify converts a display name or Obsidian filename into a clean URL/index slug.
func Slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return ""
	}
	repl := strings.NewReplacer(
		"á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n",
		" ", "-", "_", "-", "/", "-",
	)
	s = repl.Replace(s)
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevDash = false
		} else if r == '-' && !prevDash && b.Len() > 0 {
			b.WriteRune('-')
			prevDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}
