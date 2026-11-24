package compendium

import "time"

// Category constants matching both dnd5eapi.co conventions and D&D 2024 rules.
const (
	CategorySpecies     = "species"
	CategoryClasses     = "classes"
	CategorySubclasses  = "subclasses"
	CategoryBackgrounds = "backgrounds"
	CategoryFeats       = "feats"
	CategoryFeatures    = "features"
	CategoryItems       = "items"
	CategorySpells      = "spells"
	CategoryMonsters    = "monsters"
)

// AllCategories lists every supported compendium resource type.
var AllCategories = []string{
	CategorySpecies,
	CategoryClasses,
	CategorySubclasses,
	CategoryBackgrounds,
	CategoryFeats,
	CategoryFeatures,
	CategoryItems,
	CategorySpells,
	CategoryMonsters,
}

// CompendiumRef is a lightweight dnd5eapi.co-compatible reference node or Obsidian graph edge target.
type CompendiumRef struct {
	Index string `json:"index"`
	Name  string `json:"name"`
	Type  string `json:"type"`
	URL   string `json:"url,omitempty"`
}

// FeatureBrief summarizes a trait or class/species feature embedded inside another entry.
type FeatureBrief struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Level       int    `json:"level,omitempty"`
	Description string `json:"description"`
	Formula     string `json:"formula,omitempty"`
}

// Species represents a D&D 2024 playable species (no fixed ability score increases).
type Species struct {
	Slug           string         `json:"slug"`
	Name           string         `json:"name"`
	RulesetVersion string         `json:"ruleset_version"`
	SourceBook     string         `json:"source_book,omitempty"`
	CreatureType   string         `json:"creature_type"`
	Size           string         `json:"size"`
	Speed          int            `json:"speed"`
	Traits         []FeatureBrief `json:"traits"`
	Languages      []string       `json:"languages"`
	AvatarURL      string         `json:"avatar_url,omitempty"`
	Description    string         `json:"description"`
}

// Class represents a D&D 2024 character class with level progression & weapon mastery count.
type Class struct {
	Slug                 string         `json:"slug"`
	Name                 string         `json:"name"`
	RulesetVersion       string         `json:"ruleset_version"`
	SourceBook           string         `json:"source_book,omitempty"`
	HitDie               int            `json:"hit_die"`
	PrimaryAbilities     []string       `json:"primary_abilities"`
	SavingThrows         []string       `json:"saving_throws"`
	SkillChoicesCount    int            `json:"skill_choices_count"`
	SkillOptions         []string       `json:"skill_options"`
	ArmorProficiencies   []string       `json:"armor_proficiencies"`
	WeaponProficiencies  []string       `json:"weapon_proficiencies"`
	WeaponMasteriesCount int            `json:"weapon_masteries_count"`
	SpellcastingAbility  string         `json:"spellcasting_ability,omitempty"`
	Features             []FeatureBrief `json:"features"`
	Description          string         `json:"description"`
}

// Subclass represents a class specialization (level 3 standard in D&D 2024).
type Subclass struct {
	Slug           string         `json:"slug"`
	Name           string         `json:"name"`
	RulesetVersion string         `json:"ruleset_version"`
	ClassSlug      string         `json:"class_slug"`
	LevelGranted   int            `json:"level_granted"`
	Features       []FeatureBrief `json:"features"`
	Description    string         `json:"description"`
}

// Background represents a D&D 2024 background (source of +2/+1 or +1/+1/+1 ASI and Origin Feat).
type Background struct {
	Slug               string   `json:"slug"`
	Name               string   `json:"name"`
	RulesetVersion     string   `json:"ruleset_version"`
	SourceBook         string   `json:"source_book,omitempty"`
	AbilityOptions     []string `json:"ability_options"`
	OriginFeatSlug     string   `json:"origin_feat_slug"`
	OriginFeatName     string   `json:"origin_feat_name"`
	SkillProficiencies []string `json:"skill_proficiencies"`
	ToolProficiency    string   `json:"tool_proficiency"`
	StartingEquipment  []string `json:"starting_equipment"`
	StartingGold       int      `json:"starting_gold"`
	Description        string   `json:"description"`
}

// Feat represents a D&D 2024 feat categorized by ORIGIN, GENERAL, FIGHTING_STYLE, or EPIC_BOON.
type Feat struct {
	Slug                   string   `json:"slug"`
	Name                   string   `json:"name"`
	RulesetVersion         string   `json:"ruleset_version"`
	Category               string   `json:"category"` // ORIGIN | GENERAL | FIGHTING_STYLE | EPIC_BOON
	Prerequisite           string   `json:"prerequisite,omitempty"`
	Repeatable             bool     `json:"repeatable"`
	AbilityIncreaseOptions []string `json:"ability_increase_options,omitempty"`
	Benefits               []string `json:"benefits"`
	Description            string   `json:"description"`
}

// Feature represents an individual standalone feature/trait node.
type Feature struct {
	Slug           string `json:"slug"`
	Name           string `json:"name"`
	RulesetVersion string `json:"ruleset_version"`
	SourceType     string `json:"source_type"` // class | subclass | species | feat
	SourceSlug     string `json:"source_slug"`
	Level          int    `json:"level"`
	Description    string `json:"description"`
	Formula        string `json:"formula,omitempty"`
}

// Item represents weapons (with 2024 Weapon Mastery), armor, shields, consumables, and magic items.
type Item struct {
	Slug           string   `json:"slug"`
	Name           string   `json:"name"`
	RulesetVersion string   `json:"ruleset_version"`
	Category       string   `json:"category"` // weapon | armor | shield | gear | consumable | magic
	DamageFormula  string   `json:"damage_formula,omitempty"`
	DamageType     string   `json:"damage_type,omitempty"`
	Properties     []string `json:"properties,omitempty"`
	WeaponMastery  string   `json:"weapon_mastery,omitempty"` // Cleave | Graze | Nick | Push | Sap | Slow | Topple | Vex
	RangeFt        string   `json:"range_ft,omitempty"`
	ArmorClassBase int      `json:"armor_class_base,omitempty"`
	ArmorDexBonus  string   `json:"armor_dex_bonus,omitempty"` // full | max2 | none
	MagicBonus     int      `json:"magic_bonus,omitempty"`
	Rarity         string   `json:"rarity,omitempty"`
	CostGP         float64  `json:"cost_gp,omitempty"`
	WeightLB       float64  `json:"weight_lb,omitempty"`
	Description    string   `json:"description"`
}

// Spell represents a D&D 2024 spell with interactive action resolution metadata.
type Spell struct {
	Slug           string   `json:"slug"`
	Name           string   `json:"name"`
	RulesetVersion string   `json:"ruleset_version"`
	Level          int      `json:"level"`
	School         string   `json:"school"`
	CastingTime    string   `json:"casting_time"`
	RangeFt        string   `json:"range_ft"`
	Components     string   `json:"components"`
	Duration       string   `json:"duration"`
	Concentration  bool     `json:"concentration"`
	Ritual         bool     `json:"ritual"`
	AttackType     string   `json:"attack_type,omitempty"`   // "" | melee | ranged
	SaveAbility    string   `json:"save_ability,omitempty"`  // FUE | DES | CON | INT | SAB | CAR
	DamageFormula  string   `json:"damage_formula,omitempty"`
	DamageType     string   `json:"damage_type,omitempty"`
	HealFormula    string   `json:"heal_formula,omitempty"`
	AoEShape       string   `json:"aoe_shape,omitempty"`     // sphere | cone | cube | line
	AoESizeFt      int      `json:"aoe_size_ft,omitempty"`
	Classes        []string `json:"classes"`
	Description    string   `json:"description"`
}

// MonsterAction models an attack, save ability, or passive trait on a monster statblock.
type MonsterAction struct {
	Name          string `json:"name"`
	Kind          string `json:"kind"` // attack | save | trait
	AttackBonus   int    `json:"attack_bonus,omitempty"`
	ReachOrRange  string `json:"reach_or_range,omitempty"`
	DamageFormula string `json:"damage_formula,omitempty"`
	DamageType    string `json:"damage_type,omitempty"`
	SaveAbility   string `json:"save_ability,omitempty"`
	SaveDC        int    `json:"save_dc,omitempty"`
	Description   string `json:"description"`
}

// Monster represents a D&D 2024 creature statblock.
type Monster struct {
	Slug            string          `json:"slug"`
	Name            string          `json:"name"`
	RulesetVersion  string          `json:"ruleset_version"`
	Size            string          `json:"size"`
	GridSize        int             `json:"grid_size"`
	CreatureType    string          `json:"creature_type"`
	CR              string          `json:"cr"`
	CRNumeric       float64         `json:"cr_numeric"`
	XP              int             `json:"xp"`
	AC              int             `json:"ac"`
	HP              int             `json:"hp"`
	HitDice         string          `json:"hit_dice,omitempty"`
	Speed           string          `json:"speed"`
	InitiativeBonus int             `json:"initiative_bonus"`
	Abilities       map[string]int  `json:"abilities"`
	Saves           map[string]int  `json:"saves,omitempty"`
	Skills          map[string]int  `json:"skills,omitempty"`
	Traits          []MonsterAction `json:"traits,omitempty"`
	Actions         []MonsterAction `json:"actions"`
	AvatarURL       string          `json:"avatar_url,omitempty"`
	Description     string          `json:"description"`
}

// CompendiumLink represents a graph relation between two compendium nodes (Obsidian [[wikilinks]] / dnd5eapi refs).
type CompendiumLink struct {
	FromType string `json:"from_type"`
	FromSlug string `json:"from_slug"`
	ToType   string `json:"to_type"`
	ToSlug   string `json:"to_slug"`
	Relation string `json:"relation"`
}

// EntryEnvelope wraps a stored compendium entry along with resolved graph relations.
type EntryEnvelope struct {
	Category       string          `json:"category"`
	Slug           string          `json:"slug"`
	Name           string          `json:"name"`
	RulesetVersion string          `json:"ruleset_version"`
	Level          int             `json:"level"`
	SubCategory    string          `json:"sub_category"`
	Data           any             `json:"data"`
	Links          []CompendiumRef `json:"links,omitempty"`
	UpdatedAt      time.Time       `json:"updated_at,omitempty"`
}

// CompendiumStatus reports active engine status and record counts.
type CompendiumStatus struct {
	Driver    string         `json:"driver"`
	Connected bool           `json:"connected"`
	Ruleset   string         `json:"ruleset"`
	Counts    map[string]int `json:"counts"`
	Error     string         `json:"error,omitempty"`
}

// CompendiumBundle is the portable import/export structure produced by Obsidian ETL or JSON tools.
type CompendiumBundle struct {
	RulesetVersion string           `json:"ruleset_version"`
	Species        []Species        `json:"species,omitempty"`
	Classes        []Class          `json:"classes,omitempty"`
	Subclasses     []Subclass       `json:"subclasses,omitempty"`
	Backgrounds    []Background     `json:"backgrounds,omitempty"`
	Feats          []Feat           `json:"feats,omitempty"`
	Features       []Feature        `json:"features,omitempty"`
	Items          []Item           `json:"items,omitempty"`
	Spells         []Spell          `json:"spells,omitempty"`
	Monsters       []Monster        `json:"monsters,omitempty"`
	Links          []CompendiumLink `json:"links,omitempty"`
}
