import React, { useEffect, useState } from 'react'
import { Dices, Flame, Heart, Plus, Search, Shield, Skull, Swords, X } from 'lucide-react'
import { InteractiveRollAction, MapEntity, RollSource } from '../types'
import { formatSigned } from '../lib/characterRules'

interface CompendiumMonsterAction {
  name: string
  kind: 'attack' | 'save' | 'trait' | string
  attack_bonus?: number
  reach_or_range?: string
  damage_formula?: string
  damage_type?: string
  save_ability?: string
  save_dc?: number
  description: string
}

export interface CompendiumMonsterData {
  slug: string
  name: string
  size: string
  grid_size: number
  creature_type: string
  cr: string
  xp: number
  ac: number
  hp: number
  speed: string
  initiative_bonus: number
  abilities: Record<string, number>
  saves?: Record<string, number>
  actions: CompendiumMonsterAction[]
  avatar_url?: string
  description: string
}

interface MonsterSheetDrawerProps {
  open: boolean
  onClose: () => void
  selectedEntity?: MapEntity | null
  dmPIN: string
  onRollAction: (payload: {
    type: string
    dice_notation?: string
    visibility?: string
    as_dm: boolean
    pin: string
    source?: RollSource
    interactive_actions?: InteractiveRollAction[]
    target_dc?: number
  }) => void
  onDMOverride: (payload: Record<string, unknown>) => void
  onSelectMonsterContext?: (monster: CompendiumMonsterData | null) => void
}

export const MonsterSheetDrawer: React.FC<MonsterSheetDrawerProps> = ({
  open,
  onClose,
  selectedEntity,
  dmPIN,
  onRollAction,
  onDMOverride,
  onSelectMonsterContext,
}) => {
  const [monsters, setMonsters] = useState<CompendiumMonsterData[]>([])
  const [search, setSearch] = useState('')
  const [activeMonster, setActiveMonster] = useState<CompendiumMonsterData | null>(null)

  useEffect(() => {
    if (!open) return
    fetch(`/api/v1/compendium/monsters?q=${encodeURIComponent(search)}`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.results ?? []).map((env: any) => env.data as CompendiumMonsterData)
        setMonsters(list)
        if (selectedEntity?.monster_slug) {
          const match = list.find((m: CompendiumMonsterData) => m.slug === selectedEntity.monster_slug)
          if (match) {
            setActiveMonster(match)
            onSelectMonsterContext?.(match)
          }
        } else if (!activeMonster && list[0]) {
          setActiveMonster(list[0])
          onSelectMonsterContext?.(list[0])
        }
      })
      .catch(() => {})
  }, [open, search, selectedEntity?.monster_slug])

  if (!open) return null

  const spawnMonsterOnMap = (m: CompendiumMonsterData) => {
    const initRoll = Math.floor(Math.random() * 20) + 1 + (m.initiative_bonus || 0)
    onDMOverride({
      action: 'ADD_MAP_ENTITY',
      entity_kind: 'enemy',
      entity_name: m.name,
      entity_size: m.grid_size || 1,
      entity_color: '#dc2626',
      entity_hp_current: m.hp,
      entity_hp_max: m.hp,
      entity_note: `CA ${m.ac} · CR ${m.cr}`,
      entity_hidden: false,
      entity_in_initiative: true,
      entity_initiative: initRoll,
      entity_avatar_url: m.avatar_url || '',
      entity_monster_slug: m.slug,
      target_x: 2,
      target_y: 2,
    })
  }

  return (
    <aside className="fixed top-14 bottom-4 right-3 z-40 w-[calc(100vw-1.5rem)] sm:w-[420px] rounded-2xl border border-rose-500/40 bg-[#120d22]/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden text-xs text-slate-100">
      <div className="px-4 py-2.5 border-b border-rose-500/25 bg-[#090712]/85 flex items-center justify-between">
        <span className="font-extrabold text-rose-200 flex items-center gap-1.5">
          <Skull className="w-4 h-4 text-rose-400" />
          Hojas de Monstruos (Bestiario DM)
        </span>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* Selected Map Entity Live Controls */}
        {selectedEntity && (
          <div className="rounded-xl border border-amber-400/40 bg-[#090712]/85 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-extrabold text-amber-200">{selectedEntity.name}</div>
                <div className="text-[11px] text-slate-400">{selectedEntity.note || selectedEntity.kind}</div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onDMOverride({
                    action: 'UPDATE_MAP_ENTITY',
                    entity_id: selectedEntity.id,
                    entity_in_initiative: !selectedEntity.in_initiative,
                    entity_initiative: selectedEntity.initiative ?? 10,
                  })
                }
                className={`px-2 py-1 rounded-lg font-bold text-[10px] border ${
                  selectedEntity.in_initiative
                    ? 'bg-amber-400 text-slate-950 border-amber-300'
                    : 'bg-[#120d22] text-slate-300 border-violet-500/30'
                }`}
              >
                {selectedEntity.in_initiative ? `En Iniciativa (${selectedEntity.initiative ?? 10})` : '+ Añadir a Iniciativa'}
              </button>
            </div>

            {selectedEntity.hp_max > 0 && (
              <div className="flex items-center justify-between gap-2 bg-[#120d22] px-2.5 py-1.5 rounded-lg">
                <span className="flex items-center gap-1 text-emerald-300 font-bold">
                  <Heart className="w-3.5 h-3.5 text-rose-400" /> HP: {selectedEntity.hp_current}/{selectedEntity.hp_max}
                </span>
                <div className="flex gap-1">
                  {[-5, -1, 1, 5].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() =>
                        onDMOverride({
                          action: 'UPDATE_MAP_ENTITY',
                          entity_id: selectedEntity.id,
                          entity_hp_current: Math.max(0, selectedEntity.hp_current + delta),
                        })
                      }
                      className={`px-2 py-0.5 rounded font-mono font-bold ${
                        delta < 0 ? 'bg-rose-600/35 text-rose-200' : 'bg-emerald-600/35 text-emerald-200'
                      }`}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bestiary Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar monstruo en compendio..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[#090712] border border-violet-500/30 text-slate-100"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {monsters.map((m) => (
            <button
              key={m.slug}
              type="button"
              onClick={() => {
                setActiveMonster(m)
                onSelectMonsterContext?.(m)
              }}
              className={`px-2.5 py-1 rounded-lg border font-bold transition ${
                activeMonster?.slug === m.slug
                  ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                  : 'border-violet-500/20 bg-[#090712] text-slate-300'
              }`}
            >
              {m.name} (CR {m.cr})
            </button>
          ))}
        </div>

        {/* Active Compendium Monster Statblock */}
        {activeMonster && (
          <div className="rounded-xl border border-rose-500/30 bg-[#090712]/85 p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-amber-200">{activeMonster.name}</h3>
                <div className="text-[11px] text-slate-400">
                  {activeMonster.size} · {activeMonster.creature_type} · CR {activeMonster.cr} ({activeMonster.xp} XP)
                </div>
              </div>
              <button
                type="button"
                onClick={() => spawnMonsterOnMap(activeMonster)}
                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Al Mapa
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-[#120d22] border border-sky-500/25">
                <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                  <Shield className="w-3 h-3 text-sky-400" /> CA
                </div>
                <div className="font-mono font-bold text-sky-300">{activeMonster.ac}</div>
              </div>
              <div className="p-2 rounded-lg bg-[#120d22] border border-emerald-500/25">
                <div className="text-[10px] text-slate-400">HP Base</div>
                <div className="font-mono font-bold text-emerald-300">{activeMonster.hp}</div>
              </div>
              <div className="p-2 rounded-lg bg-[#120d22] border border-violet-500/25">
                <div className="text-[10px] text-slate-400">Velocidad</div>
                <div className="font-mono font-bold text-amber-200 truncate">{activeMonster.speed}</div>
              </div>
            </div>

            {/* Abilities */}
            <div className="grid grid-cols-6 gap-1 text-center">
              {Object.entries(activeMonster.abilities || {}).map(([ab, val]) => {
                const mod = Math.floor((val - 10) / 2)
                return (
                  <button
                    key={ab}
                    type="button"
                    onClick={() =>
                      onRollAction({
                        type: 'DICE',
                        dice_notation: `1d20${formatSigned(mod)}`,
                        as_dm: true,
                        pin: dmPIN,
                        source: { kind: 'monster', name: `${activeMonster.name}: ${ab}`, subtitle: `Prueba ${formatSigned(mod)}` },
                      })
                    }
                    className="p-1.5 rounded-lg bg-[#120d22] hover:bg-violet-900/50 border border-violet-500/20"
                  >
                    <div className="text-[9px] text-violet-300 font-bold">{ab}</div>
                    <div className="font-bold text-white">{val}</div>
                    <div className="text-[10px] text-amber-300 font-mono">{formatSigned(mod)}</div>
                  </button>
                )
              })}
            </div>

            {/* Monster Actions */}
            <div className="space-y-2 pt-1 border-t border-white/10">
              <div className="font-bold text-rose-300 uppercase text-[10px] tracking-wider">Acciones del Monstruo</div>
              {activeMonster.actions.map((act, idx) => (
                <div key={`${act.name}_${idx}`} className="p-2 rounded-lg bg-[#120d22] border border-rose-500/25 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-200">{act.name}</span>
                    {act.kind === 'attack' ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onRollAction({
                              type: 'DICE',
                              dice_notation: `1d20${formatSigned(act.attack_bonus || 0)}`,
                              as_dm: true,
                              pin: dmPIN,
                              source: {
                                kind: 'monster',
                                name: `${activeMonster.name} · ${act.name}`,
                                subtitle: `Ataque (${formatSigned(act.attack_bonus || 0)})`,
                              },
                              interactive_actions: act.damage_formula
                                ? [
                                    {
                                      id: `mdmg_${idx}`,
                                      kind: 'DAMAGE',
                                      label: `Rolear daño (${act.damage_formula} ${act.damage_type || ''})`,
                                      formula: act.damage_formula,
                                      damage_type: act.damage_type || '',
                                    },
                                  ]
                                : [],
                            })
                          }
                          className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1"
                        >
                          <Swords className="w-3 h-3" /> +{act.attack_bonus}
                        </button>
                        {act.damage_formula && (
                          <button
                            type="button"
                            onClick={() =>
                              onRollAction({
                                type: 'DICE',
                                dice_notation: act.damage_formula,
                                as_dm: true,
                                pin: dmPIN,
                                source: {
                                  kind: 'monster',
                                  name: `Daño: ${activeMonster.name} (${act.name})`,
                                  subtitle: act.damage_type || '',
                                },
                              })
                            }
                            className="px-2 py-1 rounded bg-[#090712] border border-rose-500/40 text-rose-200 font-mono"
                          >
                            <Dices className="w-3 h-3 inline mr-1" />
                            {act.damage_formula}
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          onRollAction({
                            type: 'ABILITY_CARD',
                            as_dm: true,
                            pin: dmPIN,
                            source: {
                              kind: 'monster',
                              name: `${activeMonster.name} · ${act.name}`,
                              subtitle: act.save_ability ? `Salvación ${act.save_ability} CD ${act.save_dc}` : 'Habilidad de Monstruo',
                            },
                            interactive_actions: [
                              ...(act.save_ability
                                ? [
                                    {
                                      id: `msave_${idx}`,
                                      kind: 'SAVE',
                                      label: `Lanzar salvación ${act.save_ability} (CD ${act.save_dc || 13})`,
                                      ability: act.save_ability,
                                      dc: act.save_dc || 13,
                                    },
                                  ]
                                : []),
                              ...(act.damage_formula
                                ? [
                                    {
                                      id: `madmg_${idx}`,
                                      kind: 'DAMAGE',
                                      label: `Rolear daño (${act.damage_formula} ${act.damage_type || ''})`,
                                      formula: act.damage_formula,
                                      damage_type: act.damage_type || '',
                                    },
                                  ]
                                : []),
                            ],
                          })
                        }
                        className="px-2.5 py-1 rounded bg-orange-500/25 border border-orange-400/50 text-orange-200 font-bold flex items-center gap-1"
                      >
                        <Flame className="w-3 h-3" /> Activar
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">{act.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
