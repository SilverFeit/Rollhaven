import React, { useState } from 'react'
import { Sparkles, Swords } from 'lucide-react'
import { RACES, RaceSVG, TOKEN_COLORS } from './RaceIcons'

interface PlayerOnboardingProps {
  onJoin: (payload: { name: string; initiative: number; race: string; color: string }) => void
  connected: boolean
  lanUrl?: string
}

export const PlayerOnboarding: React.FC<PlayerOnboardingProps> = ({ onJoin, connected }) => {
  const [name, setName] = useState('')
  const [initiative, setInitiative] = useState('10')
  const [race, setRace] = useState('human')
  const [color, setColor] = useState(TOKEN_COLORS[0])
  const [showCustomLook, setShowCustomLook] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return
    const initVal = Number.parseInt(initiative, 10)
    onJoin({
      name: cleanName,
      initiative: Number.isNaN(initVal) ? 0 : initVal,
      race,
      color,
    })
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top,_rgba(109,40,217,0.22),_#090712_65%)]">
      <div className="w-full max-w-md rounded-2xl border border-violet-500/30 bg-[#120d22]/90 backdrop-blur-xl shadow-2xl shadow-violet-950/50 p-6 sm:p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <img
            src="/app-icon.png"
            alt="Rollhaven Logo"
            className="w-20 h-20 rounded-2xl shadow-lg shadow-violet-700/30 border border-violet-500/40 mb-3"
          />
          <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-violet-300 bg-clip-text text-transparent">
            ROLLHAVEN
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Ingresa tu nombre e iniciativa para entrar a la mesa
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="player-name" className="block text-xs font-semibold uppercase tracking-wider text-violet-300 mb-1.5">
              Nombre del Aventurero
            </label>
            <input
              id="player-name"
              type="text"
              required
              autoFocus
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Thorin Escudo de Roble"
              className="w-full px-4 py-3 rounded-xl bg-[#090712] border border-violet-500/30 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400 transition"
            />
          </div>

          <div>
            <label htmlFor="player-init" className="block text-xs font-semibold uppercase tracking-wider text-violet-300 mb-1.5">
              Iniciativa
            </label>
            <input
              id="player-init"
              type="number"
              required
              min={-20}
              max={99}
              value={initiative}
              onChange={(e) => setInitiative(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[#090712] border border-violet-500/30 text-amber-200 font-bold text-lg focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400 transition"
            />
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowCustomLook((prev) => !prev)}
              className="text-xs text-violet-300/90 hover:text-amber-300 flex items-center gap-1.5 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {showCustomLook ? 'Ocultar raza y color (puedes cambiarlos luego)' : 'Personalizar raza y color de ficha (opcional)'}
            </button>

            {showCustomLook && (
              <div className="mt-3 p-3.5 rounded-xl bg-[#090712]/80 border border-violet-500/20 space-y-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase mb-2">Raza</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {RACES.map((r) => {
                      const active = race === r.id
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRace(r.id)}
                          className={`flex flex-col items-center p-2 rounded-lg border text-[11px] transition ${
                            active
                              ? 'border-amber-400 bg-violet-900/50 text-amber-200'
                              : 'border-violet-500/20 bg-slate-900/50 text-slate-400 hover:border-violet-400/40'
                          }`}
                        >
                          <RaceSVG race={r.id} color={active ? '#fde68a' : '#a78bfa'} className="w-5 h-5 mb-1" />
                          <span className="truncate w-full text-center">{r.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase mb-2">Color de Ficha</div>
                  <div className="flex flex-wrap gap-2">
                    {TOKEN_COLORS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setColor(hex)}
                        style={{ backgroundColor: hex }}
                        className={`w-7 h-7 rounded-full transition transform ${
                          color === hex ? 'ring-2 ring-white scale-110' : 'opacity-75 hover:opacity-100'
                        }`}
                        aria-label={`Color ${hex}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!connected || !name.trim()}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 disabled:opacity-45 disabled:cursor-not-allowed text-white font-bold tracking-wide shadow-lg shadow-violet-800/40 flex items-center justify-center gap-2 transition"
          >
            <Swords className="w-5 h-5" />
            {connected ? 'Entrar a la Mesa' : 'Conectando con la mesa LAN...'}
          </button>
        </form>
      </div>
    </div>
  )
}
