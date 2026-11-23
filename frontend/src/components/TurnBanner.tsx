import React from 'react'
import { ArrowRightCircle, Crown, Flame, Sparkles, Skull } from 'lucide-react'
import { Player, RollBroadcast } from '../types'
import { RaceSVG } from './RaceIcons'

interface TurnBannerProps {
  players: Player[]
  activePlayerID: string
  localPlayerID: string
  currentTurnRolls: RollBroadcast[]
  lastBroadcast: RollBroadcast | null
  onEndTurn: () => void
}

export const TurnBanner: React.FC<TurnBannerProps> = ({
  players,
  activePlayerID,
  localPlayerID,
  currentTurnRolls,
  lastBroadcast,
  onEndTurn,
}) => {
  const activePlayer = players.find((p) => p.id === activePlayerID)
  const isMyTurn = Boolean(localPlayerID && activePlayerID === localPlayerID)
  const latestRoll = currentTurnRolls.length > 0 ? currentTurnRolls[currentTurnRolls.length - 1] : lastBroadcast

  return (
    <div className="space-y-3">
      {/* Turn Indicator & Initiative Order Strip */}
      <div
        className={`rounded-2xl border p-3.5 sm:p-4 transition ${
          isMyTurn
            ? 'border-emerald-400/60 bg-gradient-to-r from-emerald-950/60 via-[#120d22] to-violet-950/60 shadow-lg shadow-emerald-950/40'
            : 'border-violet-500/25 bg-[#120d22]/85'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-white/15"
              style={{ backgroundColor: activePlayer ? `${activePlayer.color_hex}25` : '#1c1438' }}
            >
              {activePlayer ? (
                <RaceSVG race={activePlayer.race_icon} color={activePlayer.color_hex} className="w-6 h-6" />
              ) : (
                <Crown className="w-5 h-5 text-amber-300" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    isMyTurn
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${isMyTurn ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  {isMyTurn ? '¡ES TU TURNO!' : 'Turno Activo'}
                </span>
              </div>
              <div className="text-sm sm:text-base font-bold text-white truncate mt-0.5">
                {activePlayer ? (
                  <>
                    {activePlayer.name}{' '}
                    <span className="text-xs font-normal text-amber-300/90">
                      (Inic. {activePlayer.initiative})
                    </span>
                  </>
                ) : (
                  'Esperando aventureros en la mesa...'
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={!isMyTurn}
            onClick={onEndTurn}
            className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition shrink-0 ${
              isMyTurn
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 shadow-lg shadow-amber-900/40 cursor-pointer'
                : 'bg-slate-800/70 text-slate-500 border border-slate-700/50 cursor-not-allowed'
            }`}
          >
            <ArrowRightCircle className="w-4 h-4" />
            Pasar Turno
          </button>
        </div>

        {/* Initiative order pills */}
        {players.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-3 mt-3 border-t border-violet-500/15 pb-0.5">
            {players.map((p) => {
              const active = p.id === activePlayerID
              const self = p.id === localPlayerID
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs shrink-0 border transition ${
                    active
                      ? 'border-amber-400/70 bg-amber-500/15 text-amber-100 font-semibold'
                      : 'border-violet-500/20 bg-[#090712]/60 text-slate-400'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${p.is_connected ? 'bg-emerald-400' : 'bg-rose-500'}`}
                    title={p.is_connected ? 'Online' : 'Ausente'}
                  />
                  <RaceSVG race={p.race_icon} color={p.color_hex} className="w-3.5 h-3.5" />
                  <span className="max-w-[90px] truncate">{p.name}{self ? ' (Tú)' : ''}</span>
                  <span className="text-[10px] px-1 rounded bg-black/40 text-amber-300/90 font-mono">
                    {p.initiative}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Live Current Turn Results Theatre (visible to everyone) */}
      <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-3.5 sm:p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Resultado del Turno Actual
          </h2>
          <span className="text-[11px] text-slate-400">
            {currentTurnRolls.length} {currentTurnRolls.length === 1 ? 'lanzamiento en este turno' : 'lanzamientos en este turno'}
          </span>
        </div>

        {latestRoll ? (
          <div
            className={`rounded-xl p-3 sm:p-3.5 border transition ${
              latestRoll.is_critical
                ? 'border-emerald-400 bg-emerald-950/50 shadow-[0_0_24px_rgba(16,185,129,0.35)]'
                : latestRoll.is_fumble
                  ? 'border-rose-600 bg-rose-950/55 shadow-[0_0_20px_rgba(225,29,72,0.35)]'
                  : latestRoll.is_edge
                    ? 'border-amber-300 bg-amber-950/55 shadow-[0_0_28px_rgba(251,191,36,0.45)]'
                    : 'border-violet-500/30 bg-[#090712]/80'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${latestRoll.player_color}25`, border: `1px solid ${latestRoll.player_color}60` }}
                >
                  <RaceSVG race={latestRoll.race_icon} color={latestRoll.player_color} className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-amber-200">{latestRoll.player_name}</span>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-semibold">
                      {latestRoll.set_type.replace('_', ' ')}
                    </span>
                    {latestRoll.out_of_turn && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                        Fuera de turno
                      </span>
                    )}
                  </div>
                  <div className="text-base sm:text-lg font-extrabold text-white mt-0.5 break-words flex items-center gap-2">
                    {latestRoll.is_critical && <Flame className="w-5 h-5 text-emerald-400 shrink-0" />}
                    {latestRoll.is_fumble && <Skull className="w-5 h-5 text-rose-400 shrink-0" />}
                    <span>{latestRoll.result_summary}</span>
                  </div>
                </div>
              </div>
            </div>

            {currentTurnRolls.length > 1 && (
              <div className="mt-3 pt-2.5 border-t border-white/10 space-y-1 max-h-28 overflow-y-auto">
                {currentTurnRolls
                  .slice(0, -1)
                  .reverse()
                  .map((r) => (
                    <div key={r.id} className="text-xs text-slate-300 flex items-center justify-between gap-2">
                      <span className="truncate">
                        <strong className="text-violet-300">{r.player_name}</strong>: {r.result_summary}
                      </span>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-400 py-3 text-center bg-[#090712]/60 rounded-xl border border-dashed border-violet-500/20">
            Todavía no hay lanzamientos en este turno. ¡El jugador activo puede lanzar tantas veces como quiera antes de pasar turno!
          </div>
        )}
      </div>
    </div>
  )
}
