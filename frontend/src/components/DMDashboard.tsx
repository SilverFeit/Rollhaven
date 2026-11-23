import React, { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  Eye,
  EyeOff,
  GripVertical,
  KeyRound,
  Map as MapIcon,
  NotebookPen,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { useDiceboundSocket } from '../hooks/useDiceboundSocket'
import { DecisionSets } from './DecisionSets'
import { RaceSVG } from './RaceIcons'
import { TacticalMapCanvas } from './TacticalMapCanvas'
import { TurnBanner } from './TurnBanner'

function parseDeviceLabel(ua: string): string {
  if (!ua) return 'Desconocido'
  let os = 'Desktop'
  if (/iPhone/i.test(ua)) os = 'iPhone'
  else if (/iPad/i.test(ua)) os = 'iPad'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Linux/i.test(ua)) os = 'Linux'

  let browser = 'Browser'
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/Chrome\//i.test(ua)) browser = 'Chrome'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'
  else if (/Safari\//i.test(ua)) browser = 'Safari'
  return `${browser} (${os})`
}

export const DMDashboard: React.FC<{ onGoPlayerView: () => void }> = ({ onGoPlayerView }) => {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [verifiedPIN, setVerifiedPIN] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [copiedURL, setCopiedURL] = useState(false)

  // DM private notepad
  const [dmNotes, setDmNotes] = useState('')
  const [dmNoteStatus, setDmNoteStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const notesLoadedRef = useRef(false)

  // Initiative inline edit & drag-and-drop
  const [editingInit, setEditingInit] = useState<Record<string, string>>({})
  const [draggedPlayerID, setDraggedPlayerID] = useState<string | null>(null)
  const [selectedTokenID, setSelectedTokenID] = useState<string>('')
  const mapFileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    fetch('/api/v1/dm/status')
      .then((r) => r.json())
      .then((d) => {
        setAuthorized(Boolean(d.authorized))
        if (d.pin) setVerifiedPIN(d.pin)
      })
      .catch(() => setAuthorized(false))
  }, [])

  useEffect(() => {
    if (!authorized) return
    notesLoadedRef.current = false
    fetch('/api/v1/dm/notes', {
      headers: verifiedPIN ? { 'X-DM-PIN': verifiedPIN } : {},
    })
      .then((r) => r.json())
      .then((d) => {
        setDmNotes(d.content || '')
        notesLoadedRef.current = true
      })
      .catch(() => {
        notesLoadedRef.current = true
      })
  }, [authorized, verifiedPIN])

  // 500ms debounce autosave for private DM notes
  useEffect(() => {
    if (!authorized || !notesLoadedRef.current) return
    setDmNoteStatus('saving')
    const timer = window.setTimeout(() => {
      fetch('/api/v1/dm/notes', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(verifiedPIN ? { 'X-DM-PIN': verifiedPIN } : {}),
        },
        body: JSON.stringify({ content: dmNotes }),
      })
        .then(() => setDmNoteStatus('saved'))
        .catch(() => setDmNoteStatus('idle'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [dmNotes, authorized, verifiedPIN])

  const { snapshot, connected, lastBroadcast, errorMsg, sendMessage, clearError } = useDiceboundSocket({
    isDM: Boolean(authorized),
    dmPIN: verifiedPIN,
  })

  useEffect(() => {
    if (snapshot?.players?.length && !selectedTokenID) {
      setSelectedTokenID(snapshot.players[0].id)
    }
  }, [snapshot?.players, selectedTokenID])

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    try {
      const res = await fetch('/api/v1/dm/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput.trim() }),
      })
      if (!res.ok) {
        setAuthError('PIN incorrecto. Verifica el PIN de 4 dígitos en la terminal del servidor.')
        return
      }
      const data = await res.json()
      setVerifiedPIN(data.pin || pinInput.trim())
      setAuthorized(true)
    } catch {
      setAuthError('No se pudo verificar el PIN.')
    }
  }

  if (authorized === null) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#090712] text-slate-300 text-sm">
        Verificando acceso del Dungeon Master...
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top,_rgba(109,40,217,0.22),_#090712_65%)]">
        <div className="w-full max-w-sm rounded-2xl border border-violet-500/30 bg-[#120d22]/90 p-6 space-y-4 shadow-2xl">
          <div className="flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-violet-900/50 border border-amber-400/40 flex items-center justify-center mb-3">
              <KeyRound className="w-7 h-7 text-amber-300" />
            </div>
            <h1 className="text-lg font-extrabold text-amber-200">Acceso Dungeon Master</h1>
            <p className="text-xs text-slate-400 mt-1">
              Ingresa el PIN de 4 dígitos mostrado en la consola del servidor host para controlar la mesa desde este dispositivo.
            </p>
          </div>
          {authError && (
            <div className="text-xs text-rose-300 bg-rose-950/60 border border-rose-500/40 rounded-lg px-3 py-2">
              {authError}
            </div>
          )}
          <form onSubmit={handlePinSubmit} className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="PIN de 4 dígitos"
              className="w-full text-center tracking-[0.5em] text-xl font-mono font-bold px-4 py-3 rounded-xl bg-[#090712] border border-violet-500/30 text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 text-white font-bold text-sm"
            >
              Desbloquear Dashboard DM
            </button>
          </form>
          <button
            type="button"
            onClick={onGoPlayerView}
            className="w-full py-2 text-xs text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Ir a vista de Jugador
          </button>
        </div>
      </div>
    )
  }

  const lanURL = snapshot ? `http://${snapshot.lan_ip}:${snapshot.port}` : window.location.origin
  const players = snapshot?.players ?? []
  const connectedCount = players.filter((p) => p.is_connected).length

  const sendDMOverride = (payload: Record<string, unknown>) => {
    sendMessage('DM_OVERRIDE', { ...payload, pin: verifiedPIN })
  }

  const handleDropReorder = (targetPlayerID: string) => {
    if (!draggedPlayerID || draggedPlayerID === targetPlayerID) return
    const ids = players.map((p) => p.id)
    const fromIdx = ids.indexOf(draggedPlayerID)
    const toIdx = ids.indexOf(targetPlayerID)
    if (fromIdx < 0 || toIdx < 0) return
    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, draggedPlayerID)
    setDraggedPlayerID(null)
    sendDMOverride({ action: 'REORDER_PLAYERS', player_ids: ids })
  }

  const handleUploadMap = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    await fetch('/api/v1/upload/map', {
      method: 'POST',
      headers: verifiedPIN ? { 'X-DM-PIN': verifiedPIN } : {},
      body: form,
    })
    if (mapFileRef.current) mapFileRef.current.value = ''
  }

  const copyLanURL = () => {
    navigator.clipboard?.writeText(lanURL)
    setCopiedURL(true)
    window.setTimeout(() => setCopiedURL(false), 1800)
  }

  return (
    <div className="flex-1 bg-[#090712] text-slate-100 pb-10">
      {/* Top DM Header */}
      <header className="sticky top-0 z-30 border-b border-violet-500/25 bg-[#0e091b]/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/app-icon.png" alt="Dicebound" className="w-9 h-9 rounded-xl border border-violet-500/40" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-amber-200 flex items-center gap-1.5">
                  <Crown className="w-4 h-4 text-amber-400" />
                  DICEBOUND — DM DASHBOARD
                </h1>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {connected ? 'LIVE' : 'RECONECTANDO'}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
                <span>
                  IP LAN: <strong className="text-violet-300 font-mono">{lanURL}</strong>
                </span>
                {verifiedPIN && (
                  <span>
                    PIN Remoto: <strong className="text-amber-300 font-mono">{verifiedPIN}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onGoPlayerView}
            className="px-3.5 py-2 rounded-xl bg-violet-900/50 hover:bg-violet-800/60 border border-violet-500/30 text-xs font-semibold text-violet-200 flex items-center gap-1.5 transition"
          >
            <ShieldCheck className="w-4 h-4 text-amber-300" />
            Abrir Vista de Jugador
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pt-5 space-y-5">
        {errorMsg && (
          <div className="rounded-xl bg-rose-950/70 border border-rose-500/50 px-4 py-2.5 text-xs text-rose-200 flex items-center justify-between">
            <span>{errorMsg}</span>
            <button type="button" onClick={clearError} className="underline ml-3">
              Cerrar
            </button>
          </div>
        )}

        {/* Row 1: QR Connection Panel + Initiative & Turn Control */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* QR & LAN Connection Card */}
          <section className="lg:col-span-4 rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 sm:p-5 flex flex-col justify-between space-y-4">
            <div>
              <h2 className="text-sm font-bold text-amber-200 mb-1">Conexión de Jugadores en Red Local</h2>
              <p className="text-xs text-slate-400">
                Los jugadores solo escanean este código QR o abren la URL en el navegador de su móvil/PC.
              </p>
            </div>

            <div className="flex flex-col items-center bg-white p-3.5 rounded-2xl w-fit mx-auto shadow-lg">
              <QRCodeSVG value={lanURL} size={148} level="M" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 bg-[#090712] border border-violet-500/30 rounded-xl px-3 py-2">
                <span className="text-xs font-mono text-amber-200 truncate flex-1">{lanURL}</span>
                <button
                  type="button"
                  onClick={copyLanURL}
                  className="text-xs text-violet-300 hover:text-white flex items-center gap-1 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedURL ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-300 px-1">
                <span>Dispositivos en línea:</span>
                <span className="font-bold text-emerald-300">
                  {connectedCount} / {players.length} conectados
                </span>
              </div>
            </div>
          </section>

          {/* Initiative Order & Turn Control */}
          <section className="lg:col-span-8 rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-400" />
                Dispositivos Conectados &amp; Orden de Iniciativa (Arrastrar para reordenar)
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => sendDMOverride({ action: 'PREV_TURN' })}
                  className="px-3 py-1.5 rounded-xl bg-[#090712] border border-violet-500/30 hover:border-amber-400/50 text-xs font-semibold flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Anterior
                </button>
                <button
                  type="button"
                  onClick={() => sendDMOverride({ action: 'NEXT_TURN' })}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 text-xs font-bold flex items-center gap-1 shadow"
                >
                  Forzar Siguiente Turno <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Turn rules toggles */}
            <div className="flex flex-wrap gap-3 text-xs bg-[#090712]/70 p-2.5 rounded-xl border border-violet-500/15">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(snapshot?.strict_turn_rolls)}
                  onChange={(e) =>
                    sendDMOverride({ action: 'SET_TURN_RULES', strict_turn_rolls: e.target.checked })
                  }
                  className="rounded accent-violet-500"
                />
                Bloquear lanzamientos fuera de turno
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(snapshot?.strict_turn_move)}
                  onChange={(e) =>
                    sendDMOverride({ action: 'SET_TURN_RULES', strict_turn_move: e.target.checked })
                  }
                  className="rounded accent-violet-500"
                />
                Bloquear movimiento en mapa fuera de turno
              </label>
            </div>

            {/* Players / Connected Devices Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-violet-500/20 text-slate-400 uppercase text-[11px]">
                    <th className="py-2 pr-2">Orden</th>
                    <th className="py-2 pr-2">Jugador</th>
                    <th className="py-2 pr-2">IP Cliente</th>
                    <th className="py-2 pr-2">Dispositivo</th>
                    <th className="py-2 pr-2">Estado</th>
                    <th className="py-2 pr-2">Iniciativa</th>
                    <th className="py-2 text-right">Acciones DM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-violet-500/10">
                  {players.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        Esperando a que los jugadores se conecten desde {lanURL}...
                      </td>
                    </tr>
                  ) : (
                    players.map((p, index) => {
                      const isActive = p.id === snapshot?.active_player_id
                      const initVal = editingInit[p.id] ?? String(p.initiative)
                      return (
                        <tr
                          key={p.id}
                          draggable
                          onDragStart={() => setDraggedPlayerID(p.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleDropReorder(p.id)}
                          className={`transition ${
                            isActive ? 'bg-amber-500/10' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <td className="py-2.5 pr-2 cursor-grab text-slate-400">
                            <div className="flex items-center gap-1">
                              <GripVertical className="w-3.5 h-3.5" />
                              <span className="font-mono">{index + 1}</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-2">
                            <div className="flex items-center gap-2">
                              <RaceSVG race={p.race_icon} color={p.color_hex} className="w-4 h-4 shrink-0" />
                              <span className="font-bold text-slate-100">{p.name}</span>
                              {isActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-extrabold">
                                  TURNO
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 pr-2 font-mono text-slate-300">{p.client_ip || 'LAN'}</td>
                          <td className="py-2.5 pr-2 text-slate-400">{parseDeviceLabel(p.user_agent)}</td>
                          <td className="py-2.5 pr-2">
                            {p.is_connected ? (
                              <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold">
                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                Online{p.latency_ms > 0 ? ` (${p.latency_ms}ms)` : ''}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-rose-400">
                                <span className="w-2 h-2 rounded-full bg-rose-500" />
                                Ausente
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-2">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={initVal}
                                onChange={(e) =>
                                  setEditingInit((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                onBlur={() => {
                                  const parsed = Number.parseInt(initVal, 10)
                                  if (!Number.isNaN(parsed) && parsed !== p.initiative) {
                                    sendDMOverride({
                                      action: 'SET_INITIATIVE',
                                      target_player_id: p.id,
                                      value: parsed,
                                    })
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    ;(e.target as HTMLInputElement).blur()
                                  }
                                }}
                                className="w-14 px-2 py-1 rounded bg-[#090712] border border-violet-500/30 text-amber-200 font-mono text-center"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 text-right space-x-1 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                sendDMOverride({ action: 'SET_ACTIVE_PLAYER', target_player_id: p.id })
                              }
                              className="px-2 py-1 rounded bg-violet-600/30 hover:bg-violet-600/60 text-violet-200"
                            >
                              Dar turno
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                sendDMOverride({ action: 'KICK_PLAYER', target_player_id: p.id })
                              }
                              className="p-1.5 rounded text-slate-400 hover:text-rose-400 inline-flex align-middle"
                              title="Expulsar jugador"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Row 2: Current Turn Banner + DM Decision Sets & Action Log */}
        {snapshot && (
          <TurnBanner
            players={snapshot.players}
            activePlayerID={snapshot.active_player_id}
            localPlayerID=""
            currentTurnRolls={snapshot.current_turn_rolls}
            lastBroadcast={lastBroadcast}
            onEndTurn={() => sendDMOverride({ action: 'NEXT_TURN' })}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* DM Decision Launcher */}
          <div className="lg:col-span-7 space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-violet-300 px-1">
              Lanzador del Dungeon Master (Oculto o Visible en Feed Global)
            </h2>
            <DecisionSets
              onRoll={(payload) => sendMessage('ROLL_ACTION', payload)}
              lastBroadcast={lastBroadcast}
              localPlayerID="dm"
              asDM
            />
          </div>

          {/* Global Audit Log + Private DM Notepad */}
          <div className="lg:col-span-5 space-y-5">
            <section className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 space-y-3">
              <h2 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-violet-400" />
                Log Global en Tiempo Real
              </h2>
              <div className="h-56 overflow-y-auto space-y-1.5 pr-1 text-xs">
                {(snapshot?.action_log ?? []).map((entry) => (
                  <div
                    key={entry.id}
                    className="p-2 rounded-lg bg-[#090712]/75 border border-violet-500/15 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="font-bold text-amber-200">{entry.player_name}</span>{' '}
                      <span className="text-slate-300">{entry.details}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {new Date(entry.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                  <NotebookPen className="w-4 h-4 text-violet-400" />
                  Bloc de Notas Privado del DM
                </h2>
                <span className="text-[11px] text-slate-400">
                  {dmNoteStatus === 'saving'
                    ? 'Guardando...'
                    : dmNoteStatus === 'saved'
                      ? '✓ Guardado'
                      : 'Privado (solo DM)'}
                </span>
              </div>
              <textarea
                value={dmNotes}
                onChange={(e) => setDmNotes(e.target.value)}
                rows={7}
                placeholder="HP de monstruos, DC de trampas, notas secretas de la sesión..."
                className="w-full rounded-xl bg-[#090712] border border-violet-500/30 p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </section>
          </div>
        </div>

        {/* Row 3: Tactical Map Control & Canvas (5x5 to 50x50) */}
        {snapshot && (
          <section className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                  <MapIcon className="w-4 h-4 text-violet-400" />
                  Control de Mapa Táctico (5×5 a 50×50)
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    sendDMOverride({
                      action: 'UPDATE_MAP_CONFIG',
                      map_enabled: !snapshot.session.map_enabled,
                    })
                  }
                  className={`px-3 py-1 rounded-full text-xs font-extrabold transition ${
                    snapshot.session.map_enabled
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 border border-slate-600'
                  }`}
                >
                  {snapshot.session.map_enabled ? 'MAPA ACTIVADO PARA JUGADORES' : 'MAPA DESACTIVADO'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" /> Cargar Imagen de Mapa
                  <input
                    ref={mapFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleUploadMap}
                    className="hidden"
                  />
                </label>
                {snapshot.session.map_image_path && (
                  <button
                    type="button"
                    onClick={() => sendDMOverride({ action: 'CLEAR_MAP_IMAGE' })}
                    className="px-3 py-1.5 rounded-xl bg-[#090712] border border-violet-500/30 text-xs text-slate-300 hover:text-rose-300"
                  >
                    Quitar imagen
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => sendDMOverride({ action: 'RESET_TOKENS' })}
                  className="px-3 py-1.5 rounded-xl bg-[#090712] border border-violet-500/30 text-xs text-slate-200 hover:border-amber-400/60 flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Resetear Fichas
                </button>
              </div>
            </div>

            {/* Grid Size & Style Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-[#090712]/70 p-3 rounded-xl border border-violet-500/20 text-xs">
              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Columnas (5–50)</span>
                  <strong className="text-amber-200 font-mono">{snapshot.session.map_cols}</strong>
                </div>
                <input
                  type="range"
                  min={5}
                  max={50}
                  value={snapshot.session.map_cols}
                  onChange={(e) =>
                    sendDMOverride({
                      action: 'UPDATE_MAP_CONFIG',
                      map_cols: Number(e.target.value),
                    })
                  }
                  className="w-full accent-violet-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Filas (5–50)</span>
                  <strong className="text-amber-200 font-mono">{snapshot.session.map_rows}</strong>
                </div>
                <input
                  type="range"
                  min={5}
                  max={50}
                  value={snapshot.session.map_rows}
                  onChange={(e) =>
                    sendDMOverride({
                      action: 'UPDATE_MAP_CONFIG',
                      map_rows: Number(e.target.value),
                    })
                  }
                  className="w-full accent-violet-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Opacidad Grilla</span>
                  <strong className="text-amber-200 font-mono">
                    {Math.round((snapshot.session.map_grid_opacity ?? 0.35) * 100)}%
                  </strong>
                </div>
                <input
                  type="range"
                  min={10}
                  max={80}
                  value={Math.round((snapshot.session.map_grid_opacity ?? 0.35) * 100)}
                  onChange={(e) =>
                    sendDMOverride({
                      action: 'UPDATE_MAP_CONFIG',
                      map_grid_opacity: Number(e.target.value) / 100,
                    })
                  }
                  className="w-full accent-violet-500"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Color Líneas:</span>
                <div className="flex items-center gap-2">
                  {['#ffffff', '#000000', '#a78bfa', '#fbbf24'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => sendDMOverride({ action: 'UPDATE_MAP_CONFIG', map_grid_color: c })}
                      style={{ backgroundColor: c }}
                      className={`w-6 h-6 rounded-full border ${
                        snapshot.session.map_grid_color === c ? 'border-amber-400 scale-110' : 'border-slate-600'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Token selector & visibility for DM */}
            {players.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 mr-1">Mover / Visibilidad de Ficha:</span>
                {players.map((p) => {
                  const selected = selectedTokenID === p.id
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 border text-xs ${
                        selected
                          ? 'border-amber-400 bg-violet-900/50 text-amber-100'
                          : 'border-violet-500/20 bg-[#090712]/70 text-slate-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedTokenID(p.id)}
                        className="flex items-center gap-1.5 font-semibold"
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color_hex }} />
                        {p.name}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          sendDMOverride({
                            action: 'TOGGLE_TOKEN_VISIBILITY',
                            target_player_id: p.id,
                            hidden: !p.token_hidden,
                          })
                        }
                        title={p.token_hidden ? 'Mostrar ficha' : 'Ocultar ficha'}
                        className="text-slate-400 hover:text-white ml-1"
                      >
                        {p.token_hidden ? <EyeOff className="w-3.5 h-3.5 text-rose-400" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <TacticalMapCanvas
              session={snapshot.session}
              players={snapshot.players}
              localPlayerID=""
              activePlayerID={snapshot.active_player_id}
              isDM
              selectedDMPlayerID={selectedTokenID}
              onMoveToken={(pid, x, y) =>
                sendDMOverride({ action: 'MOVE_ANY_TOKEN', target_player_id: pid, target_x: x, target_y: y })
              }
            />
          </section>
        )}
      </main>
    </div>
  )
}
