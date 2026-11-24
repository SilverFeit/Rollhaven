# Esquema de Compendio D&D 2024 e Ingesta desde Obsidian

Rollhaven utiliza un esquema portable entre **SQLite** (pruebas locales) y **PostgreSQL** (servidor DietPi) inspirado en `dnd5eapi.co` pero adaptado nativamente a **D&D 2024**.

> **Nota sobre Copyright:** Ningún contenido no gratuito ni notas de tu bóveda personal de Obsidian se suben al repositorio. Usa `-import-compendium` o `POST /api/v1/compendium/import` de forma local.

## 1. Configuración de Base de Datos

```bash
# Modo local por defecto (SQLite en ./data/compendium_demo.db con fixtures sintéticos)
./rollhaven

# Modo PostgreSQL (DietPi)
./rollhaven -compendium-driver postgres -compendium-dsn "postgres://user:pass@dietpi.local:5432/rollhaven_compendium?sslmode=disable"

# Importar bóveda de Obsidian (.md) o bundle JSON antes de iniciar
./rollhaven -import-compendium "/ruta/local/vault_export"
```

También acepta variables de entorno: `ROLLHAVEN_COMPENDIUM_DRIVER` y `ROLLHAVEN_COMPENDIUM_DSN`.

## 2. Frontmatter Esperado para Notas de Obsidian (`.md`)

Cada nota de tu grafo puede incluir frontmatter YAML y enlaces `[[wikilinks]]` (los cuales se indexan automáticamente en `compendium_links`):

### Especie (`type: species`)
```yaml
---
type: species
name: Nombre de Especie
ruleset_version: "2024"
creature_type: Humanoide
size: Mediano
speed: 30
languages: [Común, Élfico]
---
Descripción y rasgos. Relacionado con [[Dote de Origen]].
```

### Background 2024 (`type: background`)
```yaml
---
type: background
name: Nombre de Trasfondo
ruleset_version: "2024"
ability_options: [FUE, DES, CON]
origin_feat: Dote de Origen
skill_proficiencies: [Percepción, Atletismo]
tool_proficiency: Kit de Cartógrafo
starting_gold: 15
---
```

### Arma / Objeto (`type: item`)
```yaml
---
type: item
item_category: weapon
name: Espada Larga
damage_formula: 1d8
damage_type: Cortante
properties: [Versátil]
weapon_mastery: Sap
---
```

### Conjuro (`type: spell`)
```yaml
---
type: spell
name: Bola de Fuego
level: 3
school: Evocación
casting_time: 1 Acción
range_ft: 150 pies
save_ability: DES
damage_formula: 8d6
damage_type: Fuego
aoe_shape: sphere
aoe_size_ft: 20
classes: [mago, hechicero]
---
```
