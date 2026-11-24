import React, { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Dices, Flame, MessageSquare, Send, ShieldAlert, Skull, Sparkles, XCircle } from 'lucide-react'
import {
  AbilityKey,
  CharacterRecord,
  ChatMessage,
  InteractiveRollAction,
  Player,
  RollBroadcast,
  RollSource,
} from '../types'
import {
  formatSigned,
  getSavingThrowMod,
  getSkillMod,
  normalizeSheetFromRecord,
} from '../lib/characterRules'
import { RaceSVG } from './RaceIcons'

export interface MonsterStatContext {
  name: string
  abilities?: Record<string, number>
  saves?: Record<string, number>
}

interface ActionChatTrackerProps {
  rolls: RollBroadcast[]
  messages: ChatMessage[]
  players: Player[]
  localPlayerID: string
  isDM?: boolean
  dmPIN?: string
  activeCharacter?: CharacterRecord
  selectedMonster?: MonsterStatContext | null
  onRollAction: (payload: {
    type: string
    dice_notation?: string
    visibility?: string
    as_dm?: boolean
    pin?: string
    source?: RollSource
    interactive_actions?: InteractiveRollAction[]
    target_dc?: number
  }) => void
  onSendChat: (payload: {
    body: string
    visibility: string
    as_dm?: boolean
    pin?: string
  }) => void
}

export const ActionChatTracker: React.FC<ActionChatTrackerProps> = ({
  rolls,
  messages,
  players,
  localPlayerID,
  isDM = false,
  dmPIN = '',
  activeCharacter,
  selectedMonster = null,
  onRollAction,
  onSendChat,
}) => {
  const [tab, setTab] = useState<'all' | 'rolls' | 'chat'>('all')
  const [chatInput, setChatInput] = useState('')
  const [visibility, setVisibility] = useState<'CAMPAIGN' | 'GM_WHISPER'>('CAMPAIGN')
  const listRef = useRef<HTMLDivElement | null>(null)

  const localPlayer = players.find((p) => p.id === localPlayerID)

  // Merge rolls and chat messages chronologically (newest at bottom)
  const timeline = useMemo(() => {
    const items: (
      | { kind: 'roll'; ts: number; roll: RollBroadcast }
      | { kind: 'chat'; ts: number; msg: ChatMessage }
    )[] = []

    if (tab === 'all' || tab === 'rolls') {
      for (const r of rolls) {
        items.push({ kind: 'roll', ts: new Date(r.timestamp).getTime() || 0, roll: r })
      }
    }
    if (tab === 'all' || tab === 'chat') {
      for (const m of messages) {
        items.push({ kind: 'chat', ts: new Date(m.created_at).getTime() || 0, msg: m })
      }
    }
    items.sort((a, b) => a.ts - b.ts)
    return items.slice(-60)
  }, [rolls, messages, tab])

  const resolveActorSaveMod = (ability: string): { mod: number; actorLabel: string } => {
    const ab = (ability || 'DES').toUpperCase() as AbilityKey
    if (isDM && selectedMonster) {
      if (selectedMonster.saves && typeof selectedMonster.saves[ab] === 'number') {
        return { mod: selectedMonster.saves[ab], actorLabel: selectedMonster.name }
      }
      const sc = selectedMonster.abilities?.[ab] ?? 10
      return { mod: Math.floor((sc - 10) / 2), actorLabel: selectedMonster.name }
    }
    if (activeCharacter || localPlayer) {
      const sheet = normalizeSheetFromRecord(
        activeCharacter?.sheet_json || localPlayer?.stats_json,
        activeCharacter?.name || localPlayer?.name || 'Aventurero'
      )
      return { mod: getSavingThrowMod(sheet, ab), actorLabel: sheet.name }
    }
    return { mod: 0, actorLabel: isDM ? 'Dungeon Master' : 'Aventurero' }
  }

  const resolveActorSkillMod = (skill: string): number => {
    if (activeCharacter || localPlayer) {
      const sheet = normalizeSheetFromRecord(
        activeCharacter?.sheet_json || localPlayer?.stats_json,
        activeCharacter?.name || localPlayer?.name || 'Aventurero'
      )
      return getSkillMod(sheet, skill)
    }
    return 0
  }

  const handleInteractiveButtonClick = (roll: RollBroadcast, act: InteractiveRollAction) => {
    const originName = roll.source?.name || roll.result_summary
    if (act.kind === 'SAVE') {
      const ab = (act.ability || 'DES').toUpperCase()
      const { mod, actorLabel } = resolveActorSaveMod(ab)
      onRollAction({
        type: 'DICE',
        dice_notation: `1d20${formatSigned(mod)}`,
        target_dc: act.dc || 0,
        as_dm: isDM,
        pin: isDM ? dmPIN : undefined,
        source: {
          kind: 'save',
          name: `Salvación ${ab} (${actorLabel})`,
          subtitle: `vs ${originName}${act.dc ? ` · CD ${act.dc}` : ''}`,
        },
      })
      return
    }
    if (act.kind === 'CHECK') {
      const sk = act.skill || 'percepcion'
      const mod = resolveActorSkillMod(sk)
      onRollAction({
        type: 'DICE',
        dice_notation: `1d20${formatSigned(mod)}`,
        target_dc: act.dc || 0,
        as_dm: isDM,
        pin: isDM ? dmPIN : undefined,
        source: {
          kind: 'skill',
          name: `Prueba ${sk}`,
          subtitle: `vs ${originName}${act.dc ? ` · CD ${act.dc}` : ''}`,
        },
      })
      return
    }
    if (act.kind === 'DAMAGE' || act.kind === 'HEAL') {
      const formula = act.formula || '1d6'
      onRollAction({
        type: 'DICE',
        dice_notation: formula,
        as_dm: isDM,
        pin: isDM ? dmPIN : undefined,
        source: {
          kind: act.kind === 'HEAL' ? 'spell' : 'weapon',
          name: `${act.kind === 'HEAL' ? 'Curación' : 'Daño'}: ${originName}`,
          subtitle: `${formula}${act.damage_type ? ` ${act.damage_type}` : ''}`,
        },
      })
    }
  }

  const handleSubmitChat = (e: React.FormEvent) => {
    e.preventDefault()
    const body = chatInput.trim()
    if (!body) return
    onSendChat({
      body,
      visibility,
      as_dm: isDM,
      pin: isDM ? dmPIN : undefined,
    })
    setChatInput('')
  }

  return (
    <div className="flex flex-col h-full text-xs text-slate-100">
      {/* Sub-tabs */}
      <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-violet-500/20">
        <div className="flex gap-1">
          {[
            { id: 'all', label: 'Todo' },
            { id: 'rolls', label: `Tiradas (${rolls.length})` },
            { id: 'chat', label: `Chat (${messages.length})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`px-2 py-1 rounded-lg font-bold transition ${
                tab === t.id ? 'bg-violet-600 text-white' : 'bg-[#090712] text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            onRollAction({
              type: 'ABILITY_CARD',
              as_dm: isDM,
              pin: isDM ? dmPIN : undefined,
              source: {
                kind: 'spell',
                name: 'Fireball / Esfera Ígnea',
                subtitle: 'Conjuro Nv. 3 · Esfera 20 ft · CD 15',
              },
              interactive_actions: [
                { id: 'fb_save', kind: 'SAVE', label: 'Lanzar tirada de salvación (DES CD 15)', ability: 'DES', dc: 15 },
                { id: 'fb_dmg', kind: 'DAMAGE', label: 'Rolear daño (8d6 Fuego)', formula: '8d6', damage_type: 'Fuego' },
              ],
            })
          }
          className="px-2 py-1 rounded-lg bg-orange-500/20 border border-orange-400/40 text-orange-200 hover:bg-orange-500/35 font-bold flex items-center gap-1"
          title="Lanzar tarjeta interactiva de Fireball"
        >
          <Flame className="w-3 h-3" /> Fireball
        </button>
      </div>

      {/* Stream */}
      <div ref={listRef} className="flex-1 overflow-y-auto py-2.5 space-y-2 pr-1">
        {timeline.length === 0 ? (
          <div className="py-10 text-center text-slate-500">
            Las tiradas, conjuros interactivos y mensajes aparecerán aquí en tiempo real.
          </div>
        ) : (
          timeline.map((item) => {
            if (item.kind === 'chat') {
              const m = item.msg
              return (
                <div
                  key={`c_${m.id}`}
                  className="rounded-xl border border-violet-500/20 bg-[#090712]/75 px-3 py-2 space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold flex items-center gap-1.5" style={{ color: m.author_color || '#e9d5ff' }}>
                      <MessageSquare className="w-3 h-3" />
                      {m.author_name}
                      {m.visibility === 'GM_WHISPER' && (
                        <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">Susurro GM</span>
                      )}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-slate-200 break-words">{m.body}</div>
                </div>
              )
            }

            const r = item.roll
            return (
              <div
                key={`r_${r.id}_${r.timestamp}`}
                className={`rounded-xl border p-2.5 space-y-2 transition ${
                  r.is_critical
                    ? 'border-emerald-400/80 bg-emerald-950/35'
                    : r.is_fumble
                      ? 'border-rose-500/80 bg-rose-950/35'
                      : r.save_outcome === 'SUCCESS'
                        ? 'border-emerald-500/55 bg-[#090712]/90'
                        : r.save_outcome === 'FAILURE'
                          ? 'border-rose-500/55 bg-[#090712]/90'
                          : 'border-violet-500/30 bg-[#090712]/85'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${r.player_color || '#7c3aed'}25` }}
                    >
                      <RaceSVG race={r.race_icon || 'human'} color={r.player_color || '#a855f7'} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-amber-200 truncate">{r.player_name}</div>
                      {r.source && (
                        <div className="flex items-center gap-1 flex-wrap text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-violet-600/35 text-violet-100 font-bold flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                            {r.source.name}
                          </span>
                          {r.source.subtitle && <span className="text-slate-400">{r.source.subtitle}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Result summary */}
                <div className="flex items-center justify-between gap-2 bg-black/35 rounded-lg px-2.5 py-1.5">
                  <div className="font-extrabold text-slate-100 flex items-center gap-1.5 break-words">
                    {r.is_critical && <Flame className="w-4 h-4 text-emerald-400 shrink-0" />}
                    {r.is_fumble && <Skull className="w-4 h-4 text-rose-400 shrink-0" />}
                    {!r.is_critical && !r.is_fumble && <Dices className="w-3.5 h-3.5 text-violet-300 shrink-0" />}
                    <span>{r.result_summary}</span>
                  </div>
                  {r.save_outcome === 'SUCCESS' && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold">
                      <CheckCircle2 className="w-3 h-3" /> ÉXITO
                    </span>
                  )}
                  {r.save_outcome === 'FAILURE' && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-extrabold">
                      <XCircle className="w-3 h-3" /> FALLO
                    </span>
                  )}
                </div>

                {/* Interactive Follow-Up Buttons */}
                {!r.masked && r.interactive_actions && r.interactive_actions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {r.interactive_actions.map((act) => (
                      <button
                        key={act.id}
                        type="button"
                        onClick={() => handleInteractiveButtonClick(r, act)}
                        className={`px-2.5 py-1 rounded-lg font-bold text-[11px] flex items-center gap-1 border transition ${
                          act.kind === 'SAVE'
                            ? 'bg-sky-500/20 hover:bg-sky-500/35 border-sky-400/50 text-sky-200'
                            : act.kind === 'DAMAGE'
                              ? 'bg-rose-500/20 hover:bg-rose-500/35 border-rose-400/50 text-rose-200'
                              : act.kind === 'HEAL'
                                ? 'bg-emerald-500/20 hover:bg-emerald-500/35 border-emerald-400/50 text-emerald-200'
                                : 'bg-amber-500/20 hover:bg-amber-500/35 border-amber-400/50 text-amber-200'
                        }`}
                      >
                        {act.kind === 'SAVE' && <ShieldAlert className="w-3 h-3" />}
                        {act.kind === 'DAMAGE' && <Flame className="w-3 h-3" />}
                        {act.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Chat & /roll Input */}
      <form onSubmit={handleSubmitChat} className="pt-2 border-t border-violet-500/20 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'CAMPAIGN' | 'GM_WHISPER')}
            className="px-2 py-1.5 rounded-lg bg-[#090712] border border-violet-500/30 text-[11px] text-amber-200"
          >
            <option value="CAMPAIGN">Público</option>
            <option value="GM_WHISPER">Susurro GM</option>
          </select>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Mensaje o /roll 1d20+5..."
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#090712] border border-violet-500/30 text-slate-100 placeholder-slate-500"
          />
          <button
            type="submit"
            className="p-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white"
            title="Enviar"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </div>
  )
}
