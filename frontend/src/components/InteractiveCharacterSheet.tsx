import React, { useState } from 'react'
import { Dices, Flame, Heart, Moon, Pin, Shield, Sparkles, Sun, Swords, Zap } from 'lucide-react'
import { AbilityKey, CharacterRecord, InteractiveRollAction, RollSource } from '../types'
import {
  ABILITY_KEYS,
  CharacterSheetData,
  DND_SKILLS,
  buildSpellRollPayload,
  calcArmorClass,
  calcProficiencyBonus,
  formatSigned,
  getAbilityMod,
  getInitiativeBonus,
  getSavingThrowMod,
  getSkillMod,
  getSpellAttackBonus,
  getSpellSaveDC,
  getTotalAbilities,
  getWeaponAttackFormula,
  getWeaponDamageFormula,
  normalizeSheetFromRecord,
} from '../lib/characterRules'
import { RaceSVG } from './RaceIcons'

export interface SheetRollDispatch {
  type: 'DICE' | 'ABILITY_CARD' | string
  dice_notation: string
  source: RollSource
  interactive_actions?: InteractiveRollAction[]
  update_initiative?: boolean
  target_dc?: number
}

interface InteractiveCharacterSheetProps {
  character?: CharacterRecord
  fallbackPlayer?: { name: string; race_icon: string; color_hex: string; avatar_url?: string; stats_json?: unknown }
  onRoll: (payload: SheetRollDispatch) => void
  onUpdateCharacter?: (updatedSheet: CharacterSheetData) => void
  onOpenWizard?: () => void
}

export const InteractiveCharacterSheet: React.FC<InteractiveCharacterSheetProps> = ({
  character,
  fallbackPlayer,
  onRoll,
  onUpdateCharacter,
  onOpenWizard,
}) => {
  const [section, setSection] = useState<'combat' | 'skills' | 'spells' | 'features'>('combat')

  const sheet = normalizeSheetFromRecord(
    character?.sheet_json || fallbackPlayer?.stats_json,
    character?.name || fallbackPlayer?.name || 'Aventurero'
  )
  const totals = getTotalAbilities(sheet)
  const pb = calcProficiencyBonus(sheet.level)
  const ac = calcArmorClass(sheet)
  const initMod = getInitiativeBonus(sheet)

  const commitSheet = async (next: CharacterSheetData) => {
    onUpdateCharacter?.(next)
    if (character?.id) {
      await fetch(`/api/v1/characters/${encodeURIComponent(character.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...character,
          name: next.name,
          level: next.level,
          sheet_json: next,
        }),
      }).catch(() => {})
    }
  }

  const toggleSkillProf = (skillId: string) => {
    const cur = sheet.skill_proficiencies?.[skillId] ?? 0
    const nextVal = ((cur + 1) % 3) as 0 | 1 | 2
    void commitSheet({
      ...sheet,
      skill_proficiencies: { ...sheet.skill_proficiencies, [skillId]: nextVal },
    })
  }

  const pinToHotbar = (label: string, kind: 'weapon_attack' | 'spell' | 'skill' | 'save', ref_id: string) => {
    const existing = sheet.hotbar_slots ?? []
    if (existing.some((s) => s.kind === kind && s.ref_id === ref_id)) return
    void commitSheet({
      ...sheet,
      hotbar_slots: [...existing, { id: `pin_${Date.now()}`, label, kind, ref_id }],
    })
  }

  return (
    <div className="space-y-3 text-xs text-slate-100">
      {/* Top Character Banner */}
      <div className="rounded-2xl border border-violet-500/30 bg-[#090712]/85 p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {sheet.avatar_url || character?.avatar_url ? (
              <img
                src={sheet.avatar_url || character?.avatar_url}
                alt={sheet.name}
                className="w-12 h-12 rounded-xl object-cover border border-amber-400/50 shrink-0"
              />
            ) : (
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center border border-violet-500/40 shrink-0"
                style={{ backgroundColor: `${sheet.color_hex || '#a855f7'}25` }}
              >
                <RaceSVG race={sheet.race_icon || 'human'} color={sheet.color_hex || '#a855f7'} className="w-7 h-7" />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-amber-200 truncate">{sheet.name}</h3>
              <div className="text-[11px] text-slate-300 truncate">
                Nv.{sheet.level} {sheet.species_name} · {sheet.class_name}
              </div>
              {sheet.background_name && (
                <div className="text-[10px] text-violet-300 truncate">Background: {sheet.background_name}</div>
              )}
            </div>
          </div>
          {onOpenWizard && (
            <button
              type="button"
              onClick={onOpenWizard}
              className="px-2.5 py-1 rounded-lg bg-violet-600/35 hover:bg-violet-600 text-violet-100 font-bold shrink-0"
            >
              + Nuevo (Wizard)
            </button>
          )}
        </div>

        {/* Core Vitals Bar */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded-xl bg-[#120d22] border border-emerald-500/30 p-2">
            <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
              <Heart className="w-3 h-3 text-rose-400" /> HP
            </div>
            <div className="flex items-center justify-center gap-1 mt-0.5 font-mono font-bold">
              <button
                type="button"
                onClick={() => void commitSheet({ ...sheet, hp_current: Math.max(0, sheet.hp_current - 1) })}
                className="px-1 text-rose-300"
              >
                -
              </button>
              <span className="text-emerald-300">{sheet.hp_current}</span>
              <span className="text-slate-500">/</span>
              <span className="text-slate-200">{sheet.hp_max}</span>
              <button
                type="button"
                onClick={() => void commitSheet({ ...sheet, hp_current: Math.min(sheet.hp_max, sheet.hp_current + 1) })}
                className="px-1 text-emerald-300"
              >
                +
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-[#120d22] border border-sky-500/30 p-2">
            <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
              <Shield className="w-3 h-3 text-sky-400" /> CA
            </div>
            <div className="font-mono font-extrabold text-sm text-sky-300 mt-0.5">{ac}</div>
          </div>

          <button
            type="button"
            onClick={() =>
              onRoll({
                type: 'DICE',
                dice_notation: `1d20${formatSigned(initMod)}`,
                update_initiative: true,
                source: { kind: 'initiative', name: 'Iniciativa', subtitle: `1d20${formatSigned(initMod)}` },
              })
            }
            className="rounded-xl bg-[#120d22] border border-amber-400/40 hover:bg-amber-500/15 p-2 transition"
            title="Lanzar iniciativa y actualizar tracker"
          >
            <div className="text-[10px] text-amber-300 flex items-center justify-center gap-1 font-bold">
              <Zap className="w-3 h-3" /> Inic.
            </div>
            <div className="font-mono font-extrabold text-sm text-amber-200 mt-0.5">{formatSigned(initMod)}</div>
          </button>

          <div className="rounded-xl bg-[#120d22] border border-violet-500/30 p-2">
            <div className="text-[10px] text-slate-400">Comp. / Vel.</div>
            <div className="font-mono font-bold text-violet-200 mt-0.5">
              +{pb} · {sheet.speed}ft
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => void commitSheet({ ...sheet, hp_current: Math.min(sheet.hp_max, sheet.hp_current + Math.ceil(sheet.hit_die / 2) + 1) })}
              className="px-2 py-1 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-300 hover:text-amber-200 flex items-center gap-1"
            >
              <Sun className="w-3 h-3" /> Descanso Corto
            </button>
            <button
              type="button"
              onClick={() => void commitSheet({ ...sheet, hp_current: sheet.hp_max, hp_temp: 0 })}
              className="px-2 py-1 rounded-lg bg-[#120d22] border border-emerald-500/30 text-emerald-300 flex items-center gap-1"
            >
              <Moon className="w-3 h-3" /> Descanso Largo
            </button>
          </div>
          {sheet.spellcasting_ability && (
            <span className="text-[11px] font-mono text-violet-300">
              CD Conj. <strong>{getSpellSaveDC(sheet)}</strong> · Atq{' '}
              <strong>{formatSigned(getSpellAttackBonus(sheet))}</strong>
            </span>
          )}
        </div>
      </div>

      {/* 6 Abilities & Saving Throws */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {ABILITY_KEYS.map((ab: AbilityKey) => {
          const score = totals[ab]
          const mod = getAbilityMod(sheet, ab)
          const saveMod = getSavingThrowMod(sheet, ab)
          const isProf = (sheet.saving_throw_proficiencies ?? []).includes(ab)
          return (
            <div key={ab} className="rounded-xl border border-violet-500/25 bg-[#090712]/80 p-2 text-center space-y-1">
              <div className="text-[10px] font-bold text-violet-300">{ab} ({score})</div>
              <button
                type="button"
                onClick={() =>
                  onRoll({
                    type: 'DICE',
                    dice_notation: `1d20${formatSigned(mod)}`,
                    source: { kind: 'ability', name: `Prueba de ${ab}`, subtitle: `Modificador ${formatSigned(mod)}` },
                  })
                }
                className="w-full py-1 rounded-lg bg-violet-600/30 hover:bg-violet-600 text-white font-mono font-extrabold flex items-center justify-center gap-1"
              >
                <Dices className="w-3 h-3" /> {formatSigned(mod)}
              </button>
              <button
                type="button"
                onClick={() =>
                  onRoll({
                    type: 'DICE',
                    dice_notation: `1d20${formatSigned(saveMod)}`,
                    source: { kind: 'save', name: `Salvación ${ab}`, subtitle: isProf ? 'Con Competencia' : 'Base' },
                  })
                }
                className={`w-full py-0.5 rounded text-[10px] font-mono border ${
                  isProf ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200 font-bold' : 'border-white/10 text-slate-400'
                }`}
              >
                Salv {formatSigned(saveMod)}
              </button>
            </div>
          )
        })}
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1.5 border-b border-violet-500/20 pb-2">
        {[
          { id: 'combat', label: 'Armas & Combate' },
          { id: 'skills', label: 'Habilidades (18)' },
          { id: 'spells', label: `Conjuros (${sheet.spells.length})` },
          { id: 'features', label: `Rasgos (${sheet.features.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id as typeof section)}
            className={`px-2.5 py-1 rounded-lg font-bold transition ${
              section === t.id ? 'bg-violet-600 text-white' : 'bg-[#090712] text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Section Content */}
      {section === 'combat' && (
        <div className="space-y-2">
          {sheet.weapons.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#090712]/60 border border-dashed border-violet-500/25 text-center text-slate-400">
              No tienes armas registradas en esta hoja. Crea o edita con el Wizard.
            </div>
          ) : (
            sheet.weapons.map((w) => {
              const atk = getWeaponAttackFormula(sheet, w)
              const dmg = getWeaponDamageFormula(sheet, w)
              return (
                <div key={w.id} className="rounded-xl border border-violet-500/25 bg-[#090712]/80 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-amber-200 flex items-center gap-1.5">
                        <Swords className="w-3.5 h-3.5 text-rose-400" />
                        {w.name}
                        {w.weapon_mastery && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/30">
                            Maestría: {w.weapon_mastery}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Atq {formatSigned(atk.bonus)} · Daño {dmg} {w.damage_type}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          void commitSheet({
                            ...sheet,
                            weapons: sheet.weapons.map((x) => (x.id === w.id ? { ...x, equipped: !x.equipped } : x)),
                          })
                        }
                        className={`px-2 py-1 rounded text-[10px] font-bold border ${
                          w.equipped ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-[#120d22] border-white/10 text-slate-400'
                        }`}
                      >
                        {w.equipped ? 'Equipada' : 'Guardar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => pinToHotbar(`Atacar: ${w.name}`, 'weapon_attack', w.id)}
                        className="p-1 rounded bg-[#120d22] text-slate-400 hover:text-amber-300"
                        title="Anclar a barra rápida"
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onRoll({
                          type: 'DICE',
                          dice_notation: atk.formula,
                          source: { kind: 'weapon', name: w.name, subtitle: `Ataque (${atk.formula})` },
                          interactive_actions: [
                            {
                              id: `dmg_${w.id}`,
                              kind: 'DAMAGE',
                              label: `Rolear Daño (${dmg} ${w.damage_type})`,
                              formula: dmg,
                              damage_type: w.damage_type,
                            },
                          ],
                        })
                      }
                      className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold"
                    >
                      ⚔️ Atacar ({atk.formula})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onRoll({
                          type: 'DICE',
                          dice_notation: dmg,
                          source: { kind: 'weapon', name: `Daño: ${w.name}`, subtitle: w.damage_type },
                        })
                      }
                      className="flex-1 py-1.5 rounded-lg bg-rose-600/85 hover:bg-rose-500 text-white font-bold"
                    >
                      🩸 Daño ({dmg})
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {section === 'skills' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto pr-1">
          {DND_SKILLS.map((sk) => {
            const mult = sheet.skill_proficiencies?.[sk.id] ?? 0
            const mod = getSkillMod(sheet, sk.id)
            return (
              <div
                key={sk.id}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#090712]/80 border border-violet-500/20"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleSkillProf(sk.id)}
                    title="Alternar competencia / pericia"
                    className={`w-4 h-4 rounded-full border text-[9px] font-bold flex items-center justify-center shrink-0 ${
                      mult === 2
                        ? 'bg-amber-400 border-amber-300 text-slate-950'
                        : mult === 1
                          ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                          : 'border-slate-600 text-transparent'
                    }`}
                  >
                    {mult === 2 ? '2' : '✓'}
                  </button>
                  <span className="truncate font-semibold text-slate-200">
                    {sk.label} <span className="text-[10px] text-slate-500">({sk.ability})</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onRoll({
                      type: 'DICE',
                      dice_notation: `1d20${formatSigned(mod)}`,
                      source: { kind: 'skill', name: sk.label, subtitle: `Habilidad (${sk.ability})` },
                    })
                  }
                  className="px-2 py-0.5 rounded bg-violet-600/35 hover:bg-violet-600 text-amber-200 font-mono font-bold shrink-0"
                >
                  {formatSigned(mod)}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {section === 'spells' && (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {sheet.spells.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#090712]/60 border border-dashed border-violet-500/25 text-center text-slate-400">
              Sin conjuros preparados en esta hoja.
            </div>
          ) : (
            sheet.spells.map((sp) => (
              <div key={sp.id} className="rounded-xl border border-violet-500/25 bg-[#090712]/80 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-amber-200 flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-orange-400" />
                      {sp.name}
                    </div>
                    <div className="text-[10px] text-violet-300">
                      Nv.{sp.level} · {sp.school}
                      {sp.save_ability ? ` · Salvación ${sp.save_ability} CD ${getSpellSaveDC(sheet)}` : ''}
                      {sp.damage_formula ? ` · ${sp.damage_formula} ${sp.damage_type || ''}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => pinToHotbar(sp.name, 'spell', sp.id)}
                      className="p-1 rounded bg-[#120d22] text-slate-400 hover:text-amber-300"
                      title="Anclar conjuro a barra rápida"
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRoll(buildSpellRollPayload(sheet, sp))}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-orange-500 text-white font-bold"
                    >
                      Lanzar
                    </button>
                  </div>
                </div>
                {sp.description && <p className="text-[11px] text-slate-400">{sp.description}</p>}
              </div>
            ))
          )}
        </div>
      )}

      {section === 'features' && (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {sheet.features.map((f) => (
            <div key={f.id} className="rounded-xl border border-violet-500/20 bg-[#090712]/80 p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-amber-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" /> {f.name}
                </span>
                <span className="text-[10px] text-violet-300">{f.source}</span>
              </div>
              <p className="text-[11px] text-slate-300">{f.description}</p>
              {f.formula && (
                <button
                  type="button"
                  onClick={() =>
                    onRoll({
                      type: 'DICE',
                      dice_notation: f.formula!,
                      source: { kind: 'feature', name: f.name, subtitle: f.source },
                    })
                  }
                  className="px-2.5 py-1 rounded bg-violet-600/40 hover:bg-violet-600 text-white font-bold"
                >
                  Activar ({f.formula})
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
