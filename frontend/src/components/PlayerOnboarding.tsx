import React, { useEffect, useState } from 'react'
import { Lock, Sparkles, Swords, UserCheck, UserPlus } from 'lucide-react'
import { RACES, RaceSVG, TOKEN_COLORS } from './RaceIcons'
import { CertificateModal } from './CertificateModal'
import { CharacterRecord, UserAccount } from '../types'

interface PlayerOnboardingProps {
  onJoin: (payload: {
    username?: string
    user_id?: string
    name?: string
    race: string
    color: string
  }) => void
  connected: boolean
  lanUrl?: string
}

export const PlayerOnboarding: React.FC<PlayerOnboardingProps> = ({ onJoin, connected }) => {
  const [users, setUsers] = useState<UserAccount[]>([])
  const [characters, setCharacters] = useState<CharacterRecord[]>([])
  const [mode, setMode] = useState<'existing' | 'new'>('new')
  const [selectedUserID, setSelectedUserID] = useState('')
  const [username, setUsername] = useState('')
  const [race, setRace] = useState('human')
  const [color, setColor] = useState(TOKEN_COLORS[0])
  const [showCustomLook, setShowCustomLook] = useState(false)
  const [certModalOpen, setCertModalOpen] = useState(false)

  useEffect(() => {
    fetch('/api/v1/users')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.users ?? []) as UserAccount[]
        const chars = (d.characters ?? []) as CharacterRecord[]
        setUsers(list)
        setCharacters(chars)
        if (list.length > 0) {
          setMode('existing')
          const savedUID = localStorage.getItem('rollhaven_user_id')
          const matched = list.find((u) => u.id === savedUID) || list[0]
          setSelectedUserID(matched.id)
        }
      })
      .catch(() => {})
  }, [])

  const selectedUser = users.find((u) => u.id === selectedUserID)
  const assignedChar = selectedUser?.active_character_id
    ? characters.find((c) => c.id === selectedUser.active_character_id)
    : undefined

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'existing' && selectedUserID) {
      onJoin({
        user_id: selectedUserID,
        username: selectedUser?.username,
        name: assignedChar?.name || selectedUser?.display_name,
        race,
        color,
      })
      return
    }
    const cleanUser = username.trim()
    if (!cleanUser) return
    onJoin({
      username: cleanUser,
      name: cleanUser,
      race,
      color,
    })
  }

  const canSubmit = connected && (mode === 'existing' ? Boolean(selectedUserID) : Boolean(username.trim()))

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
            Ingresa con tu usuario para entrar a la mesa y acceder a tu hoja
          </p>
        </div>

        {users.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-4 bg-[#090712]/80 p-1 rounded-xl border border-violet-500/20 text-xs font-bold">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                mode === 'existing' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" /> Usuario Existente
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                mode === 'new' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" /> Nuevo Usuario
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'existing' && users.length > 0 ? (
            <div className="space-y-2">
              <label htmlFor="existing-user" className="block text-xs font-semibold uppercase tracking-wider text-violet-300">
                Selecciona tu Username
              </label>
              <select
                id="existing-user"
                value={selectedUserID}
                onChange={(e) => setSelectedUserID(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-[#090712] border border-violet-500/35 text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400/60"
              >
                {users.map((u) => {
                  const ch = characters.find((c) => c.id === u.active_character_id)
                  return (
                    <option key={u.id} value={u.id}>
                      {u.username} {ch ? `— ${ch.name} (Nv.${ch.level} ${ch.class_name || ''})` : '— (Sin hoja asignada)'}
                    </option>
                  )
                })}
              </select>
              {assignedChar ? (
                <div className="text-xs rounded-xl bg-emerald-950/35 border border-emerald-500/30 px-3 py-2 text-emerald-200">
                  Personaje asignado: <strong>{assignedChar.name}</strong> ({assignedChar.species_name || '2024'} · {assignedChar.class_name || 'Aventurero'} Nv.{assignedChar.level})
                </div>
              ) : (
                <div className="text-xs rounded-xl bg-amber-950/30 border border-amber-500/30 px-3 py-2 text-amber-200">
                  Este usuario aún no tiene personaje asignado. Al entrar podrás crear uno con el Wizard o esperar al DM.
                </div>
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="player-username" className="block text-xs font-semibold uppercase tracking-wider text-violet-300 mb-1.5">
                Username
              </label>
              <input
                id="player-username"
                type="text"
                required
                autoFocus
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej. rembrandt99"
                className="w-full px-4 py-3 rounded-xl bg-[#090712] border border-violet-500/30 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400 transition"
              />
              <p className="text-[11px] text-slate-400 mt-1.5">
                Solo necesitas tu username para el primer ingreso. Tu personaje se guardará para futuras sesiones.
              </p>
            </div>
          )}

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowCustomLook((prev) => !prev)}
              className="text-xs text-violet-300/90 hover:text-amber-300 flex items-center gap-1.5 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {showCustomLook ? 'Ocultar icono y color' : 'Personalizar icono y color de ficha (opcional)'}
            </button>

            {showCustomLook && (
              <div className="mt-3 p-3.5 rounded-xl bg-[#090712]/80 border border-violet-500/20 space-y-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase mb-2">Icono base</div>
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
            disabled={!canSubmit}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 disabled:opacity-45 disabled:cursor-not-allowed text-white font-bold tracking-wide shadow-lg shadow-violet-800/40 flex items-center justify-center gap-2 transition"
          >
            <Swords className="w-5 h-5" />
            {connected ? 'Entrar a la Mesa' : 'Conectando con la mesa LAN...'}
          </button>

          <button
            type="button"
            onClick={() => setCertModalOpen(true)}
            className="w-full py-2 text-[11px] text-slate-400 hover:text-emerald-300 flex items-center justify-center gap-1.5 transition"
          >
            <Lock className="w-3.5 h-3.5" />
            ¿Ves aviso de "Sitio no seguro"? Instalar Certificado Local HTTPS
          </button>
        </form>
      </div>
      <CertificateModal open={certModalOpen} onClose={() => setCertModalOpen(false)} />
    </div>
  )
}
