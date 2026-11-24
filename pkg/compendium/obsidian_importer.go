package compendium

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var wikiLinkRegex = regexp.MustCompile(`\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]`)

// ImportFromPath imports either a JSON CompendiumBundle file or an Obsidian vault directory of .md notes.
func (r *SQLRepository) ImportFromPath(inputPath string) (int, error) {
	info, err := os.Stat(inputPath)
	if err != nil {
		return 0, fmt.Errorf("stat import path: %w", err)
	}
	if !info.IsDir() {
		raw, err := os.ReadFile(inputPath)
		if err != nil {
			return 0, err
		}
		var bundle CompendiumBundle
		if err := json.Unmarshal(raw, &bundle); err != nil {
			return 0, fmt.Errorf("invalid compendium JSON bundle: %w", err)
		}
		return r.ImportBundle(bundle)
	}

	bundle, err := ParseObsidianVault(inputPath)
	if err != nil {
		return 0, err
	}
	return r.ImportBundle(bundle)
}

// ParseObsidianVault walks an Obsidian directory, parses YAML frontmatter + [[wikilinks]], and builds a CompendiumBundle.
func ParseObsidianVault(rootDir string) (CompendiumBundle, error) {
	bundle := CompendiumBundle{RulesetVersion: "2024"}
	err := filepath.WalkDir(rootDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.EqualFold(filepath.Ext(d.Name()), ".md") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		meta, body := splitYAMLFrontmatter(string(raw))
		if len(meta) == 0 {
			return nil
		}
		cat := normalizeCategory(metaString(meta, "type", metaString(meta, "category", "")))
		if cat == "" {
			return nil
		}
		baseName := strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
		name := metaString(meta, "name", baseName)
		slug := Slugify(metaString(meta, "slug", name))
		ruleset := metaString(meta, "ruleset_version", "2024")
		desc := strings.TrimSpace(body)

		// Extract Obsidian [[wikilinks]] as graph edges
		for _, m := range wikiLinkRegex.FindAllStringSubmatch(body, -1) {
			target := strings.TrimSpace(m[1])
			if target != "" {
				bundle.Links = append(bundle.Links, CompendiumLink{
					FromType: cat,
					FromSlug: slug,
					ToType:   guessWikiTargetType(target),
					ToSlug:   Slugify(target),
					Relation: "wikilink",
				})
			}
		}

		switch cat {
		case CategorySpecies:
			bundle.Species = append(bundle.Species, Species{
				Slug: slug, Name: name, RulesetVersion: ruleset,
				CreatureType: metaString(meta, "creature_type", "Humanoide"),
				Size:         metaString(meta, "size", "Mediano"),
				Speed:        metaInt(meta, "speed", 30),
				Languages:    metaList(meta, "languages"),
				Description:  desc,
			})
		case CategoryClasses:
			bundle.Classes = append(bundle.Classes, Class{
				Slug: slug, Name: name, RulesetVersion: ruleset,
				HitDie:               metaInt(meta, "hit_die", 8),
				PrimaryAbilities:     metaList(meta, "primary_abilities"),
				SavingThrows:         metaList(meta, "saving_throws"),
				SkillChoicesCount:    metaInt(meta, "skill_choices_count", 2),
				SkillOptions:         metaList(meta, "skill_options"),
				ArmorProficiencies:   metaList(meta, "armor_proficiencies"),
				WeaponProficiencies:  metaList(meta, "weapon_proficiencies"),
				WeaponMasteriesCount: metaInt(meta, "weapon_masteries_count", 0),
				SpellcastingAbility:  metaString(meta, "spellcasting_ability", ""),
				Description:          desc,
			})
		case CategoryBackgrounds:
			bundle.Backgrounds = append(bundle.Backgrounds, Background{
				Slug: slug, Name: name, RulesetVersion: ruleset,
				AbilityOptions:     metaList(meta, "ability_options"),
				OriginFeatSlug:     Slugify(metaString(meta, "origin_feat", "")),
				OriginFeatName:     metaString(meta, "origin_feat", ""),
				SkillProficiencies: metaList(meta, "skill_proficiencies"),
				ToolProficiency:    metaString(meta, "tool_proficiency", ""),
				StartingGold:       metaInt(meta, "starting_gold", 15),
				Description:        desc,
			})
		case CategoryFeats:
			bundle.Feats = append(bundle.Feats, Feat{
				Slug: slug, Name: name, RulesetVersion: ruleset,
				Category:               strings.ToUpper(metaString(meta, "feat_category", "ORIGIN")),
				Prerequisite:           metaString(meta, "prerequisite", ""),
				Repeatable:             metaBool(meta, "repeatable", false),
				AbilityIncreaseOptions: metaList(meta, "ability_increase_options"),
				Benefits:               metaList(meta, "benefits"),
				Description:            desc,
			})
		case CategoryItems:
			bundle.Items = append(bundle.Items, Item{
				Slug: slug, Name: name, RulesetVersion: ruleset,
				Category:       strings.ToLower(metaString(meta, "item_category", "gear")),
				DamageFormula:  metaString(meta, "damage_formula", ""),
				DamageType:     metaString(meta, "damage_type", ""),
				Properties:     metaList(meta, "properties"),
				WeaponMastery:  metaString(meta, "weapon_mastery", ""),
				RangeFt:        metaString(meta, "range_ft", ""),
				ArmorClassBase: metaInt(meta, "armor_class_base", 0),
				ArmorDexBonus:  metaString(meta, "armor_dex_bonus", "full"),
				MagicBonus:     metaInt(meta, "magic_bonus", 0),
				Rarity:         metaString(meta, "rarity", "Común"),
				Description:    desc,
			})
		case CategorySpells:
			bundle.Spells = append(bundle.Spells, Spell{
				Slug: slug, Name: name, RulesetVersion: ruleset,
				Level:         metaInt(meta, "level", 0),
				School:        metaString(meta, "school", "Evocación"),
				CastingTime:   metaString(meta, "casting_time", "1 Acción"),
				RangeFt:       metaString(meta, "range_ft", "60 pies"),
				Components:    metaString(meta, "components", "V, S"),
				Duration:      metaString(meta, "duration", "Instantánea"),
				Concentration: metaBool(meta, "concentration", false),
				Ritual:        metaBool(meta, "ritual", false),
				AttackType:    metaString(meta, "attack_type", ""),
				SaveAbility:   metaString(meta, "save_ability", ""),
				DamageFormula: metaString(meta, "damage_formula", ""),
				DamageType:    metaString(meta, "damage_type", ""),
				HealFormula:   metaString(meta, "heal_formula", ""),
				AoEShape:      metaString(meta, "aoe_shape", ""),
				AoESizeFt:     metaInt(meta, "aoe_size_ft", 0),
				Classes:       metaList(meta, "classes"),
				Description:   desc,
			})
		case CategoryMonsters:
			bundle.Monsters = append(bundle.Monsters, Monster{
				Slug: slug, Name: name, RulesetVersion: ruleset,
				Size:            metaString(meta, "size", "Mediano"),
				GridSize:        max1(metaInt(meta, "grid_size", 1)),
				CreatureType:    metaString(meta, "creature_type", "Monstruosidad"),
				CR:              metaString(meta, "cr", "1"),
				AC:              metaInt(meta, "ac", 12),
				HP:              metaInt(meta, "hp", 15),
				Speed:           metaString(meta, "speed", "30 ft"),
				InitiativeBonus: metaInt(meta, "initiative_bonus", 0),
				Description:     desc,
			})
		}
		return nil
	})
	return bundle, err
}

func guessWikiTargetType(target string) string {
	lower := strings.ToLower(target)
	switch {
	case strings.Contains(lower, "feat") || strings.Contains(lower, "dote"):
		return CategoryFeats
	case strings.Contains(lower, "spell") || strings.Contains(lower, "conjuro"):
		return CategorySpells
	case strings.Contains(lower, "class") || strings.Contains(lower, "clase"):
		return CategoryClasses
	default:
		return "note"
	}
}

func splitYAMLFrontmatter(content string) (map[string]any, string) {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return nil, content
	}
	rest := normalized[4:]
	endIdx := strings.Index(rest, "\n---")
	if endIdx < 0 {
		return nil, content
	}
	fmBlock := rest[:endIdx]
	body := strings.TrimSpace(rest[endIdx+4:])

	meta := make(map[string]any)
	var currentListKey string
	for _, rawLine := range strings.Split(fmBlock, "\n") {
		trimmed := strings.TrimSpace(rawLine)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasPrefix(trimmed, "- ") && currentListKey != "" {
			item := strings.Trim(strings.TrimSpace(trimmed[2:]), `"'`)
			existing, _ := meta[currentListKey].([]string)
			meta[currentListKey] = append(existing, item)
			continue
		}
		colon := strings.IndexByte(trimmed, ':')
		if colon <= 0 {
			continue
		}
		key := strings.TrimSpace(trimmed[:colon])
		val := strings.TrimSpace(trimmed[colon+1:])
		currentListKey = ""
		if val == "" {
			currentListKey = key
			meta[key] = []string{}
			continue
		}
		if strings.HasPrefix(val, "[") && strings.HasSuffix(val, "]") {
			inner := strings.TrimSpace(val[1 : len(val)-1])
			var items []string
			for _, part := range strings.Split(inner, ",") {
				p := strings.Trim(strings.TrimSpace(part), `"'`)
				if p != "" {
					items = append(items, p)
				}
			}
			meta[key] = items
			continue
		}
		meta[key] = strings.Trim(val, `"'`)
	}
	return meta, body
}

func metaString(m map[string]any, key, def string) string {
	v, ok := m[key]
	if !ok {
		return def
	}
	if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	return def
}

func metaInt(m map[string]any, key string, def int) int {
	v, ok := m[key]
	if !ok {
		return def
	}
	if s, ok := v.(string); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
			return n
		}
	}
	return def
}

func metaBool(m map[string]any, key string, def bool) bool {
	v, ok := m[key]
	if !ok {
		return def
	}
	if s, ok := v.(string); ok {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "true", "yes", "1", "si":
			return true
		case "false", "no", "0":
			return false
		}
	}
	return def
}

func metaList(m map[string]any, key string) []string {
	v, ok := m[key]
	if !ok {
		return nil
	}
	if list, ok := v.([]string); ok {
		return list
	}
	if s, ok := v.(string); ok && s != "" {
		var out []string
		for _, part := range strings.Split(s, ",") {
			p := strings.TrimSpace(part)
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	return nil
}

func max1(v int) int {
	if v < 1 {
		return 1
	}
	return v
}
