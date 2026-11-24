import React from 'react'
import { ArrowRightCircle, ChevronLeft, ChevronRight, Crown, Skull } from 'lucide-react'
import { Combatant, Player } from '../types'
import { RaceSVG } from './RaceIcons'

interface InitiativeOverlayTrackerProps {
  combatants?: Combatant[]
  players: Player[]
  activeCombatantID?: string
  activePlayerID: string
  localPlayerID: string
  roundNumber?: number
  isDM?: boolean
  onSelectCombatant?: (c: Combatant) => void
  onEndTurn?: () => void
  onDMPrevTurn?: () => void
  onDMNextTurn?: () => void
}

export const InitiativeOverlayTracker: React.FC<InitiativeOverlayTrackerProps> = ({
  combatants,
  players,
  activeCombatantID,
  activePlayerID,
  localPlayerID,
  roundNumber = 1,
  isDM = false,
  onSelectCombatant,
  onEndTurn,
  onDMPrevTurn,
  onDMNextTurn,
}) => {
  const list: Combatant[] =
    combatants && combatants.length > 0
      ? combatants
      : players.map((p) => ({
          id: p.id,
          kind: 'player',
          name: p.name,
          initiative: p.initiative,
          avatar_url: p.avatar_url,
          race_icon: p.race_icon,
          color_hex: p.color_hex,
          token_x: p.token_x,
          token_y: p.token_y,
          is_hidden: p.token_hidden,
          is_connected: p.is_connected,
          character_id: p.character_id,
        }))

  const effectiveActiveID = activeCombatantID || activePlayerID
  const isMyTurn = Boolean(localPlayerID && effectiveActiveID === localPlayerID)

  return (
    <div className="pointer-events-auto flex items-center gap-2 max-w-[94vw] rounded-2xl border border-violet-500/40 bg-[#090712]/85 backdrop-blur-md px-2.5 py-1.5 shadow-2xl shadow-black/70">
      {/* Round Badge */}
      <div className="shrink-0 flex flex-col items-center justify-center px-2 py-1 rounded-xl bg-violet-950/70 border border-violet-500/30">
        <span className="text-[9px] uppercase tracking-wider text-violet-300 font-bold">Ronda</span>
        <span className="text-sm font-extrabold font-mono text-amber-300 leading-none">{roundNumber}</span>
      </div>

      {/* Combatants Portrait Strip */}
      <div className="flex items-center gap-2 overflow-x-auto py-0.5 px-1 no-scrollbar">
        {list.length === 0 ? (
          <div className="text-[11px] text-slate-400 px-2 py-1 flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5 text-amber-300" />
            Esperando combatientes...
          </div>
        ) : (
          list.map((cb) => {
            const isActive = cb.id === effectiveActiveID
            const isSelf = cb.id === localPlayerID
            const isMonster = cb.kind === 'monster'
            return (
              <button
                key={cb.id}
                type="button"
                onClick={() => onSelectCombatant?.(cb)}
                title={`${cb.name} (Iniciativa ${cb.initiative})${isMonster ? ' · Monstruo' : ''}`}
                className={`group relative flex flex-col items-center shrink-0 rounded-xl px-1.5 py-1 transition-all duration-300 ${
                  isActive
                    ? 'scale-105 bg-amber-500/20 border-2 border-amber-400 ring-2 ring-amber-300/60 shadow-[0_0_18px_rgba(251,191,36,0.75)]'
                    : 'border border-violet-500/25 bg-[#120d22]/90 hover:border-violet-400/60 opacity-85 hover:opacity-100'
                }`}
              >
                {/* Portrait Frame */}
                <div
                  className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-lg overflow-hidden flex items-center justify-center border ${
                    isActive ? 'border-amber-200' : 'border-white/15'
                  }`}
                  style={{ backgroundColor: `${cb.color_hex || '#7c3aed'}30` }}
                >
                  {cb.avatar_url ? (
                    <img src={cb.avatar_url} alt={cb.name} className="w-full h-full object-cover" />
                  ) : isMonster ? (
                    <Skull className="w-5 h-5" style={{ color: cb.color_hex || '#ef4444' }} />
                  ) : (
                    <RaceSVG race={cb.race_icon || 'human'} color={cb.color_hex || '#a855f7'} className="w-6 h-6" />
                  )}

                  {/* Initiative Pill */}
                  <span className="absolute -bottom-0.5 -right-0.5 px-1 rounded-tl-md bg-black/85 text-[9px] font-mono font-extrabold text-amber-300 border-t border-l border-amber-400/40">
                    {cb.initiative}
                  </span>

                  {/* Online / Hidden dot */}
                  {!isMonster && (
                    <span
                      className={`absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full ${
                        cb.is_connected ? 'bg-emerald-400' : 'bg-rose-500'
                      }`}
                    />
                  )}
                </div>

                {/* Short Name */}
                <span
                  className={`mt-0.5 max-w-[54px] truncate text-[10px] leading-tight ${
                    isActive ? 'font-extrabold text-amber-200' : isSelf ? 'font-bold text-emerald-300' : 'text-slate-300'
                  }`}
                >
                  {cb.name}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* Turn Actions */}
      {isDM ? (
        <div className="shrink-0 flex items-center gap-1 pl-1 border-l border-violet-500/25">
          <button
            type="button"
            onClick={onDMPrevTurn}
            className="p-1.5 rounded-lg bg-[#120d22] border border-violet-500/30 hover:border-amber-400 text-slate-200"
            title="Turno anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDMNextTurn}
            className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 text-[11px] font-extrabold flex items-center gap-1"
            title="Siguiente turno"
          >
            Sig. <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        isMyTurn &&
        onEndTurn && (
          <button
            type="button"
            onClick={onEndTurn}
            className="shrink-0 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 text-[11px] font-extrabold flex items-center gap-1 shadow-lg shadow-amber-900/40"
          >
            <ArrowRightCircle className="w-3.5 h-3.5" />
            Pasar Turno
          </button>
        )
      )}
    </div>
  )
}
