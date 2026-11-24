import { AbilityKey, InteractiveRollAction, RollSource } from '../types'

export const ABILITY_KEYS: AbilityKey[] = ['FUE', 'DES', 'CON', 'INT', 'SAB', 'CAR']

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  FUE: 'Fuerza',
  DES: 'Destreza',
  CON: 'Constitución',
  INT: 'Inteligencia',
  SAB: 'Sabiduría',
  CAR: 'Carisma',
}

export interface SkillDefinition {
  id: string
  label: string
  ability: AbilityKey
}

export const DND_SKILLS: SkillDefinition[] = [
  { id: 'acrobacias', label: 'Acrobacias', ability: 'DES' },
  { id: 'arcanos', label: 'Arcanos', ability: 'INT' },
  { id: 'atletismo', label: 'Atletismo', ability: 'FUE' },
  { id: 'engano', label: 'Engaño', ability: 'CAR' },
  { id: 'historia', label: 'Historia', ability: 'INT' },
  { id: 'interpretacion', label: 'Interpretación', ability: 'CAR' },
  { id: 'intimidacion', label: 'Intimidación', ability: 'CAR' },
  { id: 'investigacion', label: 'Investigación', ability: 'INT' },
  { id: 'juego_de_manos', label: 'Juego de Manos', ability: 'DES' },
  { id: 'medicina', label: 'Medicina', ability: 'SAB' },
  { id: 'naturaleza', label: 'Naturaleza', ability: 'INT' },
  { id: 'percepcion', label: 'Percepción', ability: 'SAB' },
  { id: 'perspicacia', label: 'Perspicacia', ability: 'SAB' },
  { id: 'persuasion', label: 'Persuasión', ability: 'CAR' },
  { id: 'religion', label: 'Religión', ability: 'INT' },
  { id: 'sigilo', label: 'Sigilo', ability: 'DES' },
  { id: 'supervivencia', label: 'Supervivencia', ability: 'SAB' },
  { id: 'trato_animales', label: 'Trato con Animales', ability: 'SAB' },
]

export interface SheetWeapon {
  id: string
  slug?: string
  name: string
  damage_formula: string
  damage_type: string
  properties: string[]
  weapon_mastery?: string
  magic_bonus?: number
  equipped: boolean
  proficient: boolean
  ability_override?: AbilityKey
}

export interface SheetArmor {
  id: string
  slug?: string
  name: string
  ac_base: number
  dex_cap: 'full' | 'max2' | 'none'
  is_shield?: boolean
  magic_bonus?: number
  equipped: boolean
}

export interface SheetSpell {
  id: string
  slug?: string
  name: string
  level: number
  school: string
  casting_time?: string
  range_ft?: string
  attack_type?: '' | 'melee' | 'ranged' | string
  save_ability?: AbilityKey | '' | string
  damage_formula?: string
  damage_type?: string
  heal_formula?: string
  aoe_shape?: string
  aoe_size_ft?: number
  description?: string
}

export interface SheetFeature {
  id: string
  name: string
  source: string
  description: string
  formula?: string
  uses_max?: number
  uses_left?: number
}

export interface HotbarSlot {
  id: string
  label: string
  kind: 'initiative' | 'weapon_attack' | 'weapon_damage' | 'spell' | 'skill' | 'save' | 'custom'
  ref_id?: string
  formula?: string
}

export interface CharacterSheetData {
  name: string
  level: number
  race_icon?: string
  color_hex?: string
  avatar_url?: string
  species_slug: string
  species_name: string
  class_slug: string
  class_name: string
  subclass_name?: string
  background_slug: string
  background_name: string
  hit_die: number
  speed: number
  hp_current: number
  hp_max: number
  hp_temp: number
  ac_override?: number | null
  initiative_bonus?: number
  spellcasting_ability?: AbilityKey | ''
  base_abilities: Record<AbilityKey, number>
  background_asi: Partial<Record<AbilityKey, number>>
  saving_throw_proficiencies: AbilityKey[]
  skill_proficiencies: Record<string, 0 | 1 | 2> // 0=none, 1=proficient, 2=expertise
  weapons: SheetWeapon[]
  armors: SheetArmor[]
  spells: SheetSpell[]
  features: SheetFeature[]
  hotbar_slots?: HotbarSlot[]
}

export function calcModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function formatSigned(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`
}

export function calcProficiencyBonus(level: number): number {
  const safe = Math.max(1, Math.min(20, Math.round(level || 1)))
  return Math.ceil(safe / 4) + 1
}

export function getTotalAbilities(sheet: CharacterSheetData): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>
  for (const k of ABILITY_KEYS) {
    out[k] = (sheet.base_abilities?.[k] ?? 10) + (sheet.background_asi?.[k] ?? 0)
  }
  return out
}

export function getAbilityMod(sheet: CharacterSheetData, ab: AbilityKey): number {
  const totals = getTotalAbilities(sheet)
  return calcModifier(totals[ab] ?? 10)
}

export function getSavingThrowMod(sheet: CharacterSheetData, ab: AbilityKey): number {
  const pb = calcProficiencyBonus(sheet.level)
  const prof = (sheet.saving_throw_proficiencies ?? []).includes(ab) ? pb : 0
  return getAbilityMod(sheet, ab) + prof
}

export function getSkillMod(sheet: CharacterSheetData, skillId: string): number {
  const def = DND_SKILLS.find((s) => s.id === skillId || s.label.toLowerCase() === skillId.toLowerCase())
  if (!def) return 0
  const pb = calcProficiencyBonus(sheet.level)
  const mult = sheet.skill_proficiencies?.[def.id] ?? 0
  return getAbilityMod(sheet, def.ability) + pb * mult
}

export function calcArmorClass(sheet: CharacterSheetData): number {
  if (typeof sheet.ac_override === 'number' && sheet.ac_override > 0) {
    return sheet.ac_override
  }
  const desMod = getAbilityMod(sheet, 'DES')
  const equippedBody = (sheet.armors ?? []).find((a) => a.equipped && !a.is_shield)
  const equippedShield = (sheet.armors ?? []).find((a) => a.equipped && a.is_shield)

  let ac = 10 + desMod
  if (equippedBody) {
    let dexPart = desMod
    if (equippedBody.dex_cap === 'max2') dexPart = Math.min(2, desMod)
    else if (equippedBody.dex_cap === 'none') dexPart = 0
    ac = equippedBody.ac_base + dexPart + (equippedBody.magic_bonus ?? 0)
  }
  if (equippedShield) {
    ac += equippedShield.ac_base + (equippedShield.magic_bonus ?? 0)
  }
  return ac
}

export function getInitiativeBonus(sheet: CharacterSheetData): number {
  return getAbilityMod(sheet, 'DES') + (sheet.initiative_bonus ?? 0)
}

export function getSpellSaveDC(sheet: CharacterSheetData): number {
  const ab = sheet.spellcasting_ability
  if (!ab) return 10 + calcProficiencyBonus(sheet.level)
  return 8 + calcProficiencyBonus(sheet.level) + getAbilityMod(sheet, ab)
}

export function getSpellAttackBonus(sheet: CharacterSheetData): number {
  const ab = sheet.spellcasting_ability
  if (!ab) return calcProficiencyBonus(sheet.level)
  return calcProficiencyBonus(sheet.level) + getAbilityMod(sheet, ab)
}

export function getWeaponAbility(sheet: CharacterSheetData, w: SheetWeapon): AbilityKey {
  if (w.ability_override) return w.ability_override
  const props = (w.properties ?? []).map((p) => p.toLowerCase())
  if (props.some((p) => p.includes('finesse'))) {
    return getAbilityMod(sheet, 'DES') > getAbilityMod(sheet, 'FUE') ? 'DES' : 'FUE'
  }
  if (props.some((p) => p.includes('ammunition') || p.includes('ranged'))) {
    return 'DES'
  }
  return 'FUE'
}

export function getWeaponAttackFormula(sheet: CharacterSheetData, w: SheetWeapon): { formula: string; bonus: number } {
  const ab = getWeaponAbility(sheet, w)
  const pb = w.proficient !== false ? calcProficiencyBonus(sheet.level) : 0
  const bonus = getAbilityMod(sheet, ab) + pb + (w.magic_bonus ?? 0)
  return {
    bonus,
    formula: `1d20${formatSigned(bonus)}`,
  }
}

export function getWeaponDamageFormula(sheet: CharacterSheetData, w: SheetWeapon): string {
  const ab = getWeaponAbility(sheet, w)
  const mod = getAbilityMod(sheet, ab) + (w.magic_bonus ?? 0)
  const base = (w.damage_formula || '1d6').trim()
  if (mod === 0) return base
  return `${base}${formatSigned(mod)}`
}

export function buildSpellRollPayload(sheet: CharacterSheetData, sp: SheetSpell): {
  type: string
  dice_notation: string
  source: RollSource
  interactive_actions: InteractiveRollAction[]
} {
  const dc = getSpellSaveDC(sheet)
  const atk = getSpellAttackBonus(sheet)
  const actions: InteractiveRollAction[] = []

  if (sp.save_ability) {
    actions.push({
      id: `save_${sp.slug || sp.id}`,
      kind: 'SAVE',
      label: `Lanzar Tirada de Salvación (${sp.save_ability} CD ${dc})`,
      ability: sp.save_ability,
      dc,
    })
  }
  if (sp.damage_formula) {
    actions.push({
      id: `dmg_${sp.slug || sp.id}`,
      kind: 'DAMAGE',
      label: `Rolear Daño (${sp.damage_formula} ${sp.damage_type || ''})`.trim(),
      formula: sp.damage_formula,
      damage_type: sp.damage_type || '',
    })
  }
  if (sp.heal_formula) {
    actions.push({
      id: `heal_${sp.slug || sp.id}`,
      kind: 'HEAL',
      label: `Curar (${sp.heal_formula})`,
      formula: sp.heal_formula,
    })
  }

  const source: RollSource = {
    kind: 'spell',
    name: sp.name,
    subtitle: `Conjuro Nv.${sp.level}${sp.school ? ` · ${sp.school}` : ''}${sp.save_ability ? ` · CD ${dc}` : ''}`,
  }

  if (sp.attack_type) {
    return {
      type: 'DICE',
      dice_notation: `1d20${formatSigned(atk)}`,
      source,
      interactive_actions: actions,
    }
  }

  if (!sp.save_ability && sp.heal_formula) {
    return {
      type: 'DICE',
      dice_notation: sp.heal_formula,
      source,
      interactive_actions: [],
    }
  }

  return {
    type: 'ABILITY_CARD',
    dice_notation: '',
    source,
    interactive_actions: actions,
  }
}

export function buildDefaultHotbarSlots(sheet: CharacterSheetData): HotbarSlot[] {
  if (sheet.hotbar_slots && sheet.hotbar_slots.length > 0) {
    return sheet.hotbar_slots
  }
  const slots: HotbarSlot[] = [
    { id: 'slot_init', label: 'Iniciativa', kind: 'initiative' },
  ]
  const equippedWeapons = (sheet.weapons ?? []).filter((w) => w.equipped)
  const primary = equippedWeapons[0] || sheet.weapons?.[0]
  if (primary) {
    slots.push({ id: `slot_atk_${primary.id}`, label: `Atacar: ${primary.name}`, kind: 'weapon_attack', ref_id: primary.id })
    slots.push({ id: `slot_dmg_${primary.id}`, label: `Daño: ${primary.name}`, kind: 'weapon_damage', ref_id: primary.id })
  }
  for (const sp of (sheet.spells ?? []).slice(0, 2)) {
    slots.push({ id: `slot_sp_${sp.id}`, label: sp.name, kind: 'spell', ref_id: sp.id })
  }
  slots.push({ id: 'slot_perc', label: 'Percepción', kind: 'skill', ref_id: 'percepcion' })
  return slots
}

export function normalizeSheetFromRecord(raw: unknown, fallbackName = 'Aventurero'): CharacterSheetData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CharacterSheetData>
  return {
    name: r.name || fallbackName,
    level: r.level || 1,
    race_icon: r.race_icon || 'human',
    color_hex: r.color_hex || '#a855f7',
    avatar_url: r.avatar_url || '',
    species_slug: r.species_slug || '',
    species_name: r.species_name || 'Aventurero',
    class_slug: r.class_slug || '',
    class_name: r.class_name || 'Clase Libre',
    subclass_name: r.subclass_name || '',
    background_slug: r.background_slug || '',
    background_name: r.background_name || '',
    hit_die: r.hit_die || 8,
    speed: r.speed || 30,
    hp_current: r.hp_current ?? 12,
    hp_max: r.hp_max ?? 12,
    hp_temp: r.hp_temp ?? 0,
    ac_override: r.ac_override ?? null,
    initiative_bonus: r.initiative_bonus ?? 0,
    spellcasting_ability: r.spellcasting_ability ?? '',
    base_abilities: r.base_abilities ?? { FUE: 14, DES: 14, CON: 12, INT: 10, SAB: 12, CAR: 10 },
    background_asi: r.background_asi ?? {},
    saving_throw_proficiencies: r.saving_throw_proficiencies ?? ['FUE', 'CON'],
    skill_proficiencies: r.skill_proficiencies ?? { percepcion: 1 },
    weapons: r.weapons ?? [],
    armors: r.armors ?? [],
    spells: r.spells ?? [],
    features: r.features ?? [],
    hotbar_slots: r.hotbar_slots,
  }
}
