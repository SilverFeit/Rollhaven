import React, { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Dices, Sparkles, Upload, X } from 'lucide-react'
import { AbilityKey } from '../types'
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  CharacterSheetData,
  DND_SKILLS,
  SheetArmor,
  SheetFeature,
  SheetSpell,
  SheetWeapon,
  calcModifier,
  formatSigned,
} from '../lib/characterRules'
import { RACES, RaceSVG, TOKEN_COLORS } from './RaceIcons'

interface CompendiumEnvelope<T = Record<string, any>> {
  category: string
  slug: string
  name: string
  data: T
}

interface CharacterWizardProps {
  open: boolean
  onClose: () => void
  targetUserID?: string
  targetPlayerID?: string
  defaultName?: string
  onSaved?: (character: any) => void
}

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]

export const CharacterWizard: React.FC<CharacterWizardProps> = ({
  open,
  onClose,
  targetUserID = '',
  targetPlayerID = '',
  defaultName = '',
  onSaved,
}) => {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [speciesList, setSpeciesList] = useState<CompendiumEnvelope[]>([])
  const [classesList, setClassesList] = useState<CompendiumEnvelope[]>([])
  const [backgroundsList, setBackgroundsList] = useState<CompendiumEnvelope[]>([])
  const [itemsList, setItemsList] = useState<CompendiumEnvelope[]>([])
  const [spellsList, setSpellsList] = useState<CompendiumEnvelope[]>([])

  // Wizard selections
  const [charName, setCharName] = useState(defaultName)
  const [level, setLevel] = useState(1)
  const [raceIcon, setRaceIcon] = useState('human')
  const [colorHex, setColorHex] = useState(TOKEN_COLORS[0])
  const [avatarURL, setAvatarURL] = useState('')
  const [selectedSpeciesSlug, setSelectedSpeciesSlug] = useState('')
  const [selectedClassSlug, setSelectedClassSlug] = useState('')
  const [selectedSkillSlugs, setSelectedSkillSlugs] = useState<string[]>([])
  const [selectedBgSlug, setSelectedBgSlug] = useState('')
  const [asiMode, setAsiMode] = useState<'2-1' | '1-1-1'>('2-1')
  const [asiPlus2, setAsiPlus2] = useState<AbilityKey>('FUE')
  const [asiPlus1, setAsiPlus1] = useState<AbilityKey>('CON')
  const [baseAbilities, setBaseAbilities] = useState<Record<AbilityKey, number>>({
    FUE: 15,
    DES: 14,
    CON: 13,
    INT: 10,
    SAB: 12,
    CAR: 8,
  })
  const [selectedItemSlugs, setSelectedItemSlugs] = useState<string[]>([])
  const [selectedSpellSlugs, setSelectedSpellSlugs] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetch('/api/v1/compendium/species').then((r) => r.json()),
      fetch('/api/v1/compendium/classes').then((r) => r.json()),
      fetch('/api/v1/compendium/backgrounds').then((r) => r.json()),
      fetch('/api/v1/compendium/items').then((r) => r.json()),
      fetch('/api/v1/compendium/spells').then((r) => r.json()),
    ])
      .then(([sp, cl, bg, it, spl]) => {
        const spRes = sp.results ?? []
        const clRes = cl.results ?? []
        const bgRes = bg.results ?? []
        const itRes = it.results ?? []
        const splRes = spl.results ?? []
        setSpeciesList(spRes)
        setClassesList(clRes)
        setBackgroundsList(bgRes)
        setItemsList(itRes)
        setSpellsList(splRes)
        if (spRes[0] && !selectedSpeciesSlug) setSelectedSpeciesSlug(spRes[0].slug)
        if (clRes[0] && !selectedClassSlug) setSelectedClassSlug(clRes[0].slug)
        if (bgRes[0] && !selectedBgSlug) {
          setSelectedBgSlug(bgRes[0].slug)
          const opts = (bgRes[0].data?.ability_options ?? ['FUE', 'DES', 'CON']) as AbilityKey[]
          if (opts[0]) setAsiPlus2(opts[0])
          if (opts[1]) setAsiPlus1(opts[1])
        }
        if (itRes.length > 0 && selectedItemSlugs.length === 0) {
          setSelectedItemSlugs(itRes.slice(0, 2).map((x: CompendiumEnvelope) => x.slug))
        }
      })
      .catch(() => setError('No se pudo cargar el compendio D&D 2024.'))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const activeSpecies = speciesList.find((x) => x.slug === selectedSpeciesSlug)
  const activeClass = classesList.find((x) => x.slug === selectedClassSlug)
  const activeBg = backgroundsList.find((x) => x.slug === selectedBgSlug)
  const bgAbilityOpts: AbilityKey[] = (activeBg?.data?.ability_options ?? ['FUE', 'DES', 'CON']) as AbilityKey[]

  const computeBackgroundASI = (): Partial<Record<AbilityKey, number>> => {
    if (asiMode === '1-1-1') {
      const out: Partial<Record<AbilityKey, number>> = {}
      bgAbilityOpts.slice(0, 3).forEach((ab) => {
        out[ab] = 1
      })
      return out
    }
    const out: Partial<Record<AbilityKey, number>> = {}
    out[asiPlus2] = 2
    if (asiPlus1 !== asiPlus2) out[asiPlus1] = 1
    return out
  }

  const roll4d6DropLowest = () => {
    const rollOneStat = () => {
      const rolls = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1)
      rolls.sort((a, b) => a - b)
      return rolls[1] + rolls[2] + rolls[3]
    }
    setBaseAbilities({
      FUE: rollOneStat(),
      DES: rollOneStat(),
      CON: rollOneStat(),
      INT: rollOneStat(),
      SAB: rollOneStat(),
      CAR: rollOneStat(),
    })
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/v1/upload/avatar', { method: 'POST', body: form })
      if (res.ok) {
        const d = await res.json()
        if (d.file_path) setAvatarURL(d.file_path)
        return
      }
    } catch {
      // Fallback to local data URL preview if upload endpoint unavailable
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setAvatarURL(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const buildSheetPayload = (): CharacterSheetData => {
    const bgASI = computeBackgroundASI()
    const conTotal = (baseAbilities.CON || 10) + (bgASI.CON || 0)
    const conMod = calcModifier(conTotal)
    const hitDie = Number(activeClass?.data?.hit_die || 8)
    const maxHP = Math.max(1, hitDie + conMod + (level - 1) * (Math.floor(hitDie / 2) + 1 + conMod))

    const skillProfs: Record<string, 0 | 1 | 2> = {}
    const bgSkills: string[] = activeBg?.data?.skill_proficiencies ?? []
    for (const sName of [...bgSkills, ...selectedSkillSlugs]) {
      const matched = DND_SKILLS.find((sk) => sk.id === sName || sk.label.toLowerCase() === sName.toLowerCase())
      if (matched) skillProfs[matched.id] = 1
    }

    const weapons: SheetWeapon[] = []
    const armors: SheetArmor[] = []
    for (const slug of selectedItemSlugs) {
      const item = itemsList.find((x) => x.slug === slug)?.data
      if (!item) continue
      if (item.category === 'weapon') {
        weapons.push({
          id: `w_${slug}`,
          slug,
          name: item.name,
          damage_formula: item.damage_formula || '1d6',
          damage_type: item.damage_type || 'Cortante',
          properties: item.properties || [],
          weapon_mastery: item.weapon_mastery || '',
          magic_bonus: item.magic_bonus || 0,
          equipped: true,
          proficient: true,
        })
      } else if (item.category === 'armor' || item.category === 'shield') {
        armors.push({
          id: `a_${slug}`,
          slug,
          name: item.name,
          ac_base: item.armor_class_base || (item.category === 'shield' ? 2 : 12),
          dex_cap: item.armor_dex_bonus || 'full',
          is_shield: item.category === 'shield',
          magic_bonus: item.magic_bonus || 0,
          equipped: true,
        })
      }
    }

    const spells: SheetSpell[] = selectedSpellSlugs
      .map((slug) => spellsList.find((x) => x.slug === slug)?.data)
      .filter(Boolean)
      .map((sp: any) => ({
        id: `sp_${sp.slug}`,
        slug: sp.slug,
        name: sp.name,
        level: sp.level || 0,
        school: sp.school || 'Evocación',
        casting_time: sp.casting_time,
        range_ft: sp.range_ft,
        attack_type: sp.attack_type || '',
        save_ability: sp.save_ability || '',
        damage_formula: sp.damage_formula || '',
        damage_type: sp.damage_type || '',
        heal_formula: sp.heal_formula || '',
        aoe_shape: sp.aoe_shape || '',
        aoe_size_ft: sp.aoe_size_ft || 0,
        description: sp.description || '',
      }))

    const features: SheetFeature[] = []
    for (const t of activeSpecies?.data?.traits ?? []) {
      features.push({ id: `sp_${t.slug}`, name: t.name, source: activeSpecies?.name || 'Especie', description: t.description })
    }
    for (const f of activeClass?.data?.features ?? []) {
      features.push({ id: `cl_${f.slug}`, name: f.name, source: activeClass?.name || 'Clase', description: f.description, formula: f.formula })
    }
    if (activeBg?.data?.origin_feat_name) {
      features.push({
        id: `bg_${activeBg.data.origin_feat_slug}`,
        name: activeBg.data.origin_feat_name,
        source: `Origin Feat · ${activeBg.name}`,
        description: 'Dote de Origen otorgada por el Background (reglas 2024).',
      })
    }

    return {
      name: charName.trim() || 'Aventurero',
      level,
      race_icon: raceIcon,
      color_hex: colorHex,
      avatar_url: avatarURL,
      species_slug: activeSpecies?.slug || '',
      species_name: activeSpecies?.name || 'Especie',
      class_slug: activeClass?.slug || '',
      class_name: activeClass?.name || 'Clase',
      background_slug: activeBg?.slug || '',
      background_name: activeBg?.name || 'Background',
      hit_die: hitDie,
      speed: Number(activeSpecies?.data?.speed || 30),
      hp_current: maxHP,
      hp_max: maxHP,
      hp_temp: 0,
      initiative_bonus: 0,
      spellcasting_ability: (activeClass?.data?.spellcasting_ability || '') as AbilityKey | '',
      base_abilities: baseAbilities,
      background_asi: bgASI,
      saving_throw_proficiencies: (activeClass?.data?.saving_throws ?? ['FUE', 'CON']) as AbilityKey[],
      skill_proficiencies: skillProfs,
      weapons,
      armors,
      spells,
      features,
    }
  }

  const handleSave = async () => {
    if (!charName.trim()) {
      setError('Ingresa un nombre para el personaje.')
      setStep(1)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const sheet = buildSheetPayload()
      const res = await fetch('/api/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: targetUserID,
          name: sheet.name,
          avatar_url: sheet.avatar_url,
          level: sheet.level,
          species_slug: sheet.species_slug,
          species_name: sheet.species_name,
          class_slug: sheet.class_slug,
          class_name: sheet.class_name,
          background_slug: sheet.background_slug,
          background_name: sheet.background_name,
          sheet_json: sheet,
        }),
      })
      const saved = await res.json()
      if (!res.ok) {
        setError(saved.error || 'Error guardando personaje')
        return
      }
      if (targetUserID || targetPlayerID) {
        await fetch('/api/v1/dm/assign-character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: targetUserID,
            player_id: targetPlayerID,
            character_id: saved.id,
          }),
        }).catch(() => {})
      }
      onSaved?.(saved)
      onClose()
    } catch {
      setError('Error de red guardando la hoja de personaje')
    } finally {
      setSaving(false)
    }
  }

  const previewSheet = buildSheetPayload()

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl border border-violet-500/40 bg-[#120d22] text-slate-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-violet-500/25 bg-[#090712]/80 flex items-center justify-between">
          <div>
            <h2 className="text-base font-extrabold text-amber-200 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Wizard Creador de Personaje (D&amp;D 2024)
            </h2>
            <p className="text-[11px] text-slate-400">Paso {step} de 7 · Conectado al Compendio</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Pills */}
        <div className="px-5 py-2 border-b border-violet-500/15 flex gap-1.5 overflow-x-auto text-[11px]">
          {['Identidad', 'Especie', 'Clase', 'Background', 'Atributos', 'Equipo/Conjuros', 'Resumen'].map((lbl, i) => (
            <button
              key={lbl}
              type="button"
              onClick={() => setStep(i + 1)}
              className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition ${
                step === i + 1
                  ? 'bg-amber-400 text-slate-950'
                  : step > i + 1
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-[#090712] text-slate-400'
              }`}
            >
              {i + 1}. {lbl}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {error && (
            <div className="rounded-xl bg-rose-950/70 border border-rose-500/50 px-3 py-2 text-rose-200">{error}</div>
          )}
          {loading ? (
            <div className="py-12 text-center text-slate-400">Cargando opciones del compendio...</div>
          ) : (
            <>
              {step === 1 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-violet-300 font-bold mb-1">Nombre del Personaje</label>
                      <input
                        type="text"
                        value={charName}
                        onChange={(e) => setCharName(e.target.value)}
                        placeholder="Ej. Lyra Vientoestelar"
                        className="w-full px-3 py-2.5 rounded-xl bg-[#090712] border border-violet-500/35 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-violet-300 font-bold mb-1">Nivel Inicial</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={level}
                        onChange={(e) => setLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                        className="w-full px-3 py-2.5 rounded-xl bg-[#090712] border border-violet-500/35 text-sm text-amber-200 font-mono font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl bg-[#090712]/70 border border-violet-500/20 space-y-2">
                      <div className="font-bold text-slate-300">Retrato (para Mapa e Iniciativa)</div>
                      <div className="flex items-center gap-3">
                        {avatarURL ? (
                          <img src={avatarURL} alt="Retrato" className="w-14 h-14 rounded-xl object-cover border border-amber-400/50" />
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-[#120d22] border border-violet-500/30 flex items-center justify-center">
                            <RaceSVG race={raceIcon} color={colorHex} className="w-8 h-8" />
                          </div>
                        )}
                        <label className="cursor-pointer px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold inline-flex items-center gap-1.5">
                          <Upload className="w-3.5 h-3.5" /> Subir Imagen
                          <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                        </label>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#090712]/70 border border-violet-500/20 space-y-2">
                      <div className="font-bold text-slate-300">Color &amp; Silueta Base</div>
                      <div className="flex flex-wrap gap-1.5">
                        {TOKEN_COLORS.map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => setColorHex(hex)}
                            style={{ backgroundColor: hex }}
                            className={`w-6 h-6 rounded-full ${colorHex === hex ? 'ring-2 ring-white scale-110' : 'opacity-70'}`}
                          />
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {RACES.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setRaceIcon(r.id)}
                            className={`px-2 py-1 rounded border text-[10px] ${
                              raceIcon === r.id ? 'border-amber-400 bg-violet-900/50 text-amber-200' : 'border-violet-500/20 text-slate-400'
                            }`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {speciesList.map((sp) => {
                    const active = sp.slug === selectedSpeciesSlug
                    return (
                      <button
                        key={sp.slug}
                        type="button"
                        onClick={() => setSelectedSpeciesSlug(sp.slug)}
                        className={`text-left p-3.5 rounded-xl border transition space-y-1.5 ${
                          active ? 'border-amber-400 bg-violet-900/40' : 'border-violet-500/20 bg-[#090712]/70 hover:border-violet-400/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-extrabold text-amber-200">{sp.name}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200">
                            {sp.data.speed || 30} ft · {sp.data.size || 'Mediano'}
                          </span>
                        </div>
                        <p className="text-slate-300 text-[11px]">{sp.data.description}</p>
                        {(sp.data.traits ?? []).map((tr: any) => (
                          <div key={tr.slug} className="text-[11px] text-emerald-300/90">
                            • <strong>{tr.name}:</strong> {tr.description}
                          </div>
                        ))}
                      </button>
                    )
                  })}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {classesList.map((cl) => {
                      const active = cl.slug === selectedClassSlug
                      return (
                        <button
                          key={cl.slug}
                          type="button"
                          onClick={() => {
                            setSelectedClassSlug(cl.slug)
                            setSelectedSkillSlugs([])
                          }}
                          className={`text-left p-3.5 rounded-xl border transition space-y-1.5 ${
                            active ? 'border-amber-400 bg-violet-900/40' : 'border-violet-500/20 bg-[#090712]/70 hover:border-violet-400/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-extrabold text-amber-200">{cl.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                              d{cl.data.hit_die || 8}
                            </span>
                          </div>
                          <div className="text-[11px] text-violet-300">
                            Salvaciones: {(cl.data.saving_throws ?? []).join(', ')}
                          </div>
                          <p className="text-[11px] text-slate-300">{cl.data.description}</p>
                        </button>
                      )
                    })}
                  </div>

                  {activeClass && (
                    <div className="p-3.5 rounded-xl bg-[#090712]/75 border border-violet-500/20 space-y-2">
                      <div className="font-bold text-amber-200">
                        Elige hasta {activeClass.data.skill_choices_count || 2} habilidades de clase:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(activeClass.data.skill_options ?? []).map((sk: string) => {
                          const picked = selectedSkillSlugs.includes(sk)
                          const limit = activeClass.data.skill_choices_count || 2
                          return (
                            <button
                              key={sk}
                              type="button"
                              onClick={() => {
                                if (picked) {
                                  setSelectedSkillSlugs((prev) => prev.filter((x) => x !== sk))
                                } else if (selectedSkillSlugs.length < limit) {
                                  setSelectedSkillSlugs((prev) => [...prev, sk])
                                }
                              }}
                              className={`px-2.5 py-1 rounded-lg border font-semibold ${
                                picked ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-[#120d22] text-slate-300 border-violet-500/25'
                              }`}
                            >
                              {sk}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {backgroundsList.map((bg) => {
                      const active = bg.slug === selectedBgSlug
                      return (
                        <button
                          key={bg.slug}
                          type="button"
                          onClick={() => {
                            setSelectedBgSlug(bg.slug)
                            const opts = (bg.data.ability_options ?? ['FUE', 'DES', 'CON']) as AbilityKey[]
                            if (opts[0]) setAsiPlus2(opts[0])
                            if (opts[1]) setAsiPlus1(opts[1])
                          }}
                          className={`text-left p-3.5 rounded-xl border transition space-y-1.5 ${
                            active ? 'border-amber-400 bg-violet-900/40' : 'border-violet-500/20 bg-[#090712]/70'
                          }`}
                        >
                          <div className="text-sm font-extrabold text-amber-200">{bg.name}</div>
                          <div className="text-[11px] text-emerald-300">
                            Origin Feat (2024): <strong>{bg.data.origin_feat_name || 'N/A'}</strong>
                          </div>
                          <div className="text-[11px] text-violet-300">
                            Habilidades: {(bg.data.skill_proficiencies ?? []).join(', ')}
                          </div>
                          <p className="text-[11px] text-slate-300">{bg.data.description}</p>
                        </button>
                      )
                    })}
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#090712]/80 border border-amber-400/30 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-amber-200">Bonos de Atributo de Background (Reglas 2024)</span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAsiMode('2-1')}
                          className={`px-2.5 py-1 rounded font-bold ${asiMode === '2-1' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-300'}`}
                        >
                          +2 / +1
                        </button>
                        <button
                          type="button"
                          onClick={() => setAsiMode('1-1-1')}
                          className={`px-2.5 py-1 rounded font-bold ${asiMode === '1-1-1' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-300'}`}
                        >
                          +1 / +1 / +1
                        </button>
                      </div>
                    </div>
                    {asiMode === '2-1' ? (
                      <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-1.5">
                          <span className="text-emerald-300 font-bold">+2 a:</span>
                          <select
                            value={asiPlus2}
                            onChange={(e) => setAsiPlus2(e.target.value as AbilityKey)}
                            className="bg-[#120d22] border border-violet-500/30 rounded px-2 py-1 text-white"
                          >
                            {bgAbilityOpts.map((ab) => (
                              <option key={ab} value={ab}>{ab}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5">
                          <span className="text-sky-300 font-bold">+1 a:</span>
                          <select
                            value={asiPlus1}
                            onChange={(e) => setAsiPlus1(e.target.value as AbilityKey)}
                            className="bg-[#120d22] border border-violet-500/30 rounded px-2 py-1 text-white"
                          >
                            {bgAbilityOpts.filter((x) => x !== asiPlus2).map((ab) => (
                              <option key={ab} value={ab}>{ab}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <div className="text-emerald-300">+1 a cada uno de: {bgAbilityOpts.slice(0, 3).join(', ')}</div>
                    )}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-amber-200">Asigna tus 6 Atributos Base</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setBaseAbilities({ FUE: 15, DES: 14, CON: 13, INT: 10, SAB: 12, CAR: 8 })
                        }
                        className="px-2.5 py-1 rounded-lg bg-[#090712] border border-violet-500/30 text-slate-200"
                      >
                        Standard Array ({STANDARD_ARRAY.join(', ')})
                      </button>
                      <button
                        type="button"
                        onClick={roll4d6DropLowest}
                        className="px-2.5 py-1 rounded-lg bg-violet-600 text-white font-bold flex items-center gap-1"
                      >
                        <Dices className="w-3.5 h-3.5" /> Tirar 4d6dl1
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {ABILITY_KEYS.map((ab) => {
                      const bgBonus = computeBackgroundASI()[ab] ?? 0
                      const total = baseAbilities[ab] + bgBonus
                      return (
                        <div key={ab} className="p-3 rounded-xl bg-[#090712]/80 border border-violet-500/25 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-violet-300">{ABILITY_LABELS[ab]} ({ab})</span>
                            {bgBonus > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                                +{bgBonus} BG
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={3}
                              max={20}
                              value={baseAbilities[ab]}
                              onChange={(e) =>
                                setBaseAbilities((prev) => ({
                                  ...prev,
                                  [ab]: Math.max(3, Math.min(20, Number(e.target.value) || 10)),
                                }))
                              }
                              className="w-16 px-2 py-1 rounded bg-[#120d22] border border-violet-500/30 text-amber-200 font-mono font-bold text-center"
                            />
                            <div className="text-slate-300">
                              Total: <strong className="text-white">{total}</strong>{' '}
                              <span className="text-emerald-300 font-mono">({formatSigned(calcModifier(total))})</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {step === 6 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="font-bold text-amber-200">Equipamiento, Armas (con Maestría 2024) y Armaduras</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {itemsList.map((it) => {
                        const checked = selectedItemSlugs.includes(it.slug)
                        return (
                          <button
                            key={it.slug}
                            type="button"
                            onClick={() =>
                              setSelectedItemSlugs((prev) =>
                                checked ? prev.filter((x) => x !== it.slug) : [...prev, it.slug]
                              )
                            }
                            className={`text-left p-2.5 rounded-xl border transition flex items-start justify-between gap-2 ${
                              checked ? 'border-amber-400 bg-violet-900/35' : 'border-violet-500/20 bg-[#090712]/70'
                            }`}
                          >
                            <div>
                              <div className="font-bold text-slate-100">{it.name}</div>
                              <div className="text-[10px] text-slate-400">
                                {it.data.category}
                                {it.data.damage_formula ? ` · ${it.data.damage_formula} ${it.data.damage_type || ''}` : ''}
                                {it.data.weapon_mastery ? ` · Maestría: ${it.data.weapon_mastery}` : ''}
                                {it.data.armor_class_base ? ` · CA ${it.data.armor_class_base}` : ''}
                              </div>
                            </div>
                            {checked && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="font-bold text-amber-200">Conjuros Iniciales</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {spellsList.map((sp) => {
                        const checked = selectedSpellSlugs.includes(sp.slug)
                        return (
                          <button
                            key={sp.slug}
                            type="button"
                            onClick={() =>
                              setSelectedSpellSlugs((prev) =>
                                checked ? prev.filter((x) => x !== sp.slug) : [...prev, sp.slug]
                              )
                            }
                            className={`text-left p-2.5 rounded-xl border transition flex items-start justify-between gap-2 ${
                              checked ? 'border-amber-400 bg-violet-900/35' : 'border-violet-500/20 bg-[#090712]/70'
                            }`}
                          >
                            <div>
                              <div className="font-bold text-slate-100">{sp.name}</div>
                              <div className="text-[10px] text-violet-300">
                                Nv.{sp.data.level} · {sp.data.school}
                                {sp.data.damage_formula ? ` · ${sp.data.damage_formula} ${sp.data.damage_type || ''}` : ''}
                              </div>
                            </div>
                            {checked && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {step === 7 && (
                <div className="space-y-3 bg-[#090712]/75 p-4 rounded-xl border border-emerald-500/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-extrabold text-amber-200">{previewSheet.name}</h3>
                      <p className="text-slate-300">
                        Nv.{previewSheet.level} {previewSheet.species_name} · {previewSheet.class_name} ({previewSheet.background_name})
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-emerald-300 font-bold">HP {previewSheet.hp_max}</div>
                      <div className="text-sky-300">Vel. {previewSheet.speed} ft</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-6 gap-2 text-center">
                    {ABILITY_KEYS.map((ab) => {
                      const val = (previewSheet.base_abilities[ab] ?? 10) + (previewSheet.background_asi[ab] ?? 0)
                      return (
                        <div key={ab} className="p-2 rounded-lg bg-[#120d22] border border-violet-500/25">
                          <div className="text-[10px] text-slate-400">{ab}</div>
                          <div className="font-bold text-white">{val}</div>
                          <div className="text-[11px] text-amber-300 font-mono">{formatSigned(calcModifier(val))}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="text-slate-300">
                    <strong>Armas/Armaduras:</strong> {previewSheet.weapons.length} armas, {previewSheet.armors.length} armaduras ·{' '}
                    <strong>Conjuros:</strong> {previewSheet.spells.length} · <strong>Rasgos:</strong> {previewSheet.features.length}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Nav */}
        <div className="px-5 py-3 border-t border-violet-500/25 bg-[#090712]/90 flex items-center justify-between">
          <button
            type="button"
            disabled={step <= 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="px-3.5 py-2 rounded-xl bg-[#120d22] border border-violet-500/30 text-xs font-bold text-slate-300 disabled:opacity-40 flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>

          {step < 7 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(7, s + 1))}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1"
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-amber-500 text-slate-950 text-xs font-extrabold flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> {saving ? 'Guardando...' : 'Crear Hoja Interactiva'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
