import React, { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudFog,
  Copy,
  Crown,
  DoorOpen,
  Download,
  Eye,
  EyeOff,
  Flame,
  FolderPlus,
  Gem,
  GripVertical,
  Hand,
  HardDrive,
  KeyRound,
  Lock,
  Map as MapIcon,
  MapPin,
  NotebookPen,
  PauseCircle,
  PlayCircle,
  Radio,
  RefreshCw,
  Save,
  ScrollText,
  Shield,
  ShieldCheck,
  Skull,
  Sparkles,
  StopCircle,
  Swords,
  Trash2,
  Upload,
  Users,
  Volume2,
} from 'lucide-react'
import { useDiceboundSocket } from '../hooks/useDiceboundSocket'
import { MapEntityKind, SceneCard } from '../types'
import { DND_CONDITIONS, SOUNDBOARD_CLIPS, calculateEncounterDifficulty, crToXP, playTabletopSound } from '../lib/srdCompendiumAndGenerators'
import { CertificateModal } from './CertificateModal'
import { CompanionHub } from './CompanionHub'
import { DecisionSets } from './DecisionSets'
import { RaceSVG } from './RaceIcons'
import { DMSelection, TacticalMapCanvas } from './TacticalMapCanvas'
import { TurnBanner } from './TurnBanner'

const ENTITY_CATEGORIES: {
  kind: MapEntityKind
  label: string
  defaultColor: string
  defaultHP: number
  presets: { name: string; hp: number; size: number; note: string }[]
}[] = [
  {
    kind: 'enemy',
    label: 'Enemigo',
    defaultColor: '#dc2626',
    defaultHP: 18,
    presets: [
      { name: 'Goblin', hp: 7, size: 1, note: 'AC 15' },
      { name: 'Orco', hp: 15, size: 1, note: 'AC 13' },
      { name: 'Ogro', hp: 59, size: 2, note: 'AC 11 · Grande 2×2' },
      { name: 'Dragón', hp: 178, size: 3, note: 'AC 18 · Enorme 3×3' },
    ],
  },
  {
    kind: 'trap',
    label: 'Trampa',
    defaultColor: '#f59e0b',
    defaultHP: 0,
    presets: [
      { name: 'Trampa Foso', hp: 0, size: 1, note: 'DC 14 Percepción · 2d6' },
      { name: 'Dardos', hp: 0, size: 1, note: 'DC 15 Destreza · 1d10' },
      { name: 'Runa Explosiva', hp: 0, size: 2, note: 'DC 15 Arcano · 5d8' },
    ],
  },
  {
    kind: 'item',
    label: 'Ítem / Tesoro',
    defaultColor: '#06b6d4',
    defaultHP: 0,
    presets: [
      { name: 'Cofre', hp: 0, size: 1, note: 'Botín / Cerradura DC 12' },
      { name: 'Poción', hp: 0, size: 1, note: 'Curación 2d4+2' },
      { name: 'Reliquia', hp: 0, size: 1, note: 'Objeto mágico' },
    ],
  },
  {
    kind: 'npc',
    label: 'NPC / Aliado',
    defaultColor: '#3b82f6',
    defaultHP: 12,
    presets: [
      { name: 'Guardia', hp: 11, size: 1, note: 'Aliado / Neutral' },
      { name: 'Mercader', hp: 9, size: 1, note: 'Comercio / Misión' },
      { name: 'Mago', hp: 22, size: 1, note: 'Conjuros' },
    ],
  },
  {
    kind: 'hazard',
    label: 'Peligro / Área',
    defaultColor: '#f97316',
    defaultHP: 0,
    presets: [
      { name: 'Fuego', hp: 0, size: 2, note: '1d6 fuego al iniciar turno' },
      { name: 'Ácido / Lava', hp: 0, size: 2, note: '2d10 daño área' },
      { name: 'Niebla / Oscuridad', hp: 0, size: 3, note: 'Visibilidad nula' },
    ],
  },
  {
    kind: 'door',
    label: 'Puerta / Punto',
    defaultColor: '#a16207',
    defaultHP: 20,
    presets: [
      { name: 'Puerta Cerrada', hp: 20, size: 1, note: 'Ganzúa DC 15' },
      { name: 'Puerta Secreta', hp: 20, size: 1, note: 'Investigación DC 16' },
      { name: 'Portal / Altar', hp: 0, size: 2, note: 'Punto interactivo' },
    ],
  },
]

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
  const [qrHTTPS, setQrHTTPS] = useState(true)

  // DM private notepad
  const [dmNotes, setDmNotes] = useState('')
  const [dmNoteStatus, setDmNoteStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const notesLoadedRef = useRef(false)

  // Initiative inline edit & drag-and-drop
  const [editingInit, setEditingInit] = useState<Record<string, string>>({})
  const [draggedPlayerID, setDraggedPlayerID] = useState<string | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<DMSelection | null>(null)
  const [dmMapMode, setDmMapMode] = useState<'move' | 'place'>('move')
  const [entityKind, setEntityKind] = useState<MapEntityKind>('enemy')
  const [entityName, setEntityName] = useState('Goblin')
  const [entityHP, setEntityHP] = useState('7')
  const [entitySize, setEntitySize] = useState(1)
  const [entityColor, setEntityColor] = useState('#dc2626')
  const [entityNote, setEntityNote] = useState('AC 15')
  const [entityHidden, setEntityHidden] = useState(false)
  const mapFileRef = useRef<HTMLInputElement | null>(null)
  const restoreFileRef = useRef<HTMLInputElement | null>(null)

  // Campaign, session & backup controls
  const [creatingCampaign, setCreatingCampaign] = useState(false)
  const [newCampName, setNewCampName] = useState('')
  const [newCampSystem, setNewCampSystem] = useState('D&D 5e / Universal')
  const [newCampDesc, setNewCampDesc] = useState('')
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [backupStatus, setBackupStatus] = useState<string | null>(null)

  // v1.5.0: Certificates / Tunnel, Scene Presets, Fari Cards & Clocks, CR/Mob & Entity Tactics
  const [certModalOpen, setCertModalOpen] = useState(false)
  const [customQrURL, setCustomQrURL] = useState<string | null>(null)
  const [newSceneName, setNewSceneName] = useState('')
  const [newCardTitle, setNewCardTitle] = useState('')
  const [newCardSubtitle, setNewCardSubtitle] = useState('')
  const [newCardKind, setNewCardKind] = useState<'aspect' | 'clock'>('clock')
  const [newCardSegments, setNewCardSegments] = useState(4)
  const [partyAvgLevel, setPartyAvgLevel] = useState(3)
  const [mobName, setMobName] = useState('Goblin')
  const [mobCount, setMobCount] = useState(4)
  const [mobAtkBonus, setMobAtkBonus] = useState(4)
  const [mobTargetAC, setMobTargetAC] = useState(15)
  const [mobDmgNotation, setMobDmgNotation] = useState('1d6+2')
  const [entityTacticalOpenID, setEntityTacticalOpenID] = useState<string | null>(null)

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

  const {
    snapshot,
    connected,
    lastBroadcast,
    tempEvents,
    errorMsg,
    noteConflict,
    sendMessage,
    clearError,
    clearNoteConflict,
  } = useDiceboundSocket({
    isDM: Boolean(authorized),
    dmPIN: verifiedPIN,
    enabled: Boolean(authorized),
  })

  useEffect(() => {
    if (snapshot?.players?.length && !selectedTarget) {
      setSelectedTarget({ kind: 'player', id: snapshot.players[0].id })
    }
  }, [snapshot?.players, selectedTarget])

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

  const lanScheme = qrHTTPS ? 'https' : 'http'
  const lanURL = snapshot ? `${lanScheme}://${snapshot.lan_ip}:${snapshot.port}` : window.location.origin
  const activeQRURL = customQrURL || lanURL
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
    navigator.clipboard?.writeText(activeQRURL)
    setCopiedURL(true)
    window.setTimeout(() => setCopiedURL(false), 1800)
  }

  const handleCreateCampaign = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCampName.trim()) return
    sendDMOverride({
      action: 'CREATE_CAMPAIGN',
      campaign_name: newCampName.trim(),
      campaign_system: newCampSystem.trim() || 'D&D 5e / Universal',
      campaign_desc: newCampDesc.trim(),
    })
    setNewCampName('')
    setNewCampDesc('')
    setCreatingCampaign(false)
  }

  const handleDownloadProtected = async (url: string, fallbackName: string) => {
    setBackupStatus('Generando archivo...')
    try {
      const res = await fetch(url, {
        headers: verifiedPIN ? { 'X-DM-PIN': verifiedPIN } : {},
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setBackupStatus(d.error || 'Error generando descarga')
        return
      }
      const blob = await res.blob()
      const objectURL = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectURL
      a.download = fallbackName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectURL)
      setBackupStatus(`Descargado: ${fallbackName}`)
    } catch {
      setBackupStatus('No se pudo descargar el backup')
    }
  }

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ok = window.confirm(
      `¿Seguro que deseas restaurar "${file.name}"? Esto reemplazará el estado de la campaña actual tras validar su firma SHA-256.`
    )
    if (!ok) {
      if (restoreFileRef.current) restoreFileRef.current.value = ''
      return
    }
    setBackupStatus('Verificando checksum SHA-256 y restaurando...')
    try {
      const isJSON = file.name.toLowerCase().endsWith('.json')
      let res: Response
      if (isJSON) {
        const text = await file.text()
        res = await fetch('/api/v1/campaigns/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(verifiedPIN ? { 'X-DM-PIN': verifiedPIN } : {}),
          },
          body: text,
        })
      } else {
        const form = new FormData()
        form.append('file', file)
        res = await fetch('/api/v1/backups/restore', {
          method: 'POST',
          headers: verifiedPIN ? { 'X-DM-PIN': verifiedPIN } : {},
          body: form,
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBackupStatus(data.error || 'Error validando/restaurando backup')
      } else {
        setBackupStatus('✓ Campaña y adjuntos restaurados e íntegros')
      }
    } catch {
      setBackupStatus('Error de red al restaurar backup')
    } finally {
      if (restoreFileRef.current) restoreFileRef.current.value = ''
    }
  }

  return (
    <div className="flex-1 bg-[#090712] text-slate-100 pb-10">
      {/* Top DM Header */}
      <header className="sticky top-0 z-30 border-b border-violet-500/25 bg-[#0e091b]/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/app-icon.png" alt="Rollhaven" className="w-9 h-9 rounded-xl border border-violet-500/40" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-amber-200 flex items-center gap-1.5">
                  <Crown className="w-4 h-4 text-amber-400" />
                  ROLLHAVEN — DM DASHBOARD
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

        {/* Row 0: Rollhaven Campaign & Session Lifecycle Bar */}
        {snapshot && (
          <section className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                  <Crown className="w-4 h-4 text-amber-400" />
                  Campaña Activa:
                </div>
                <select
                  value={snapshot.active_campaign?.id || 'default'}
                  onChange={(e) => sendDMOverride({ action: 'SWITCH_CAMPAIGN', campaign_id: e.target.value })}
                  className="px-3 py-1.5 rounded-xl bg-[#090712] border border-violet-500/35 text-xs font-bold text-amber-100"
                >
                  {(snapshot.campaigns ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.status === 'ARCHIVED' ? '(Archivada)' : ''}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#090712] text-violet-300 border border-violet-500/20">
                  seq #{snapshot.sequence ?? 0}
                </span>
                <button
                  type="button"
                  onClick={() => setCreatingCampaign((v) => !v)}
                  className="px-2.5 py-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1"
                >
                  <FolderPlus className="w-3.5 h-3.5" /> Nueva Campaña
                </button>
                {snapshot.active_campaign && snapshot.active_campaign.id !== 'default' && (
                  <button
                    type="button"
                    onClick={() =>
                      sendDMOverride({
                        action: 'ARCHIVE_CAMPAIGN',
                        campaign_id: snapshot.active_campaign!.id,
                        archived: snapshot.active_campaign!.status !== 'ARCHIVED',
                      })
                    }
                    className="px-2.5 py-1.5 rounded-xl bg-[#090712] border border-violet-500/30 text-xs text-slate-300 hover:text-amber-200 flex items-center gap-1"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    {snapshot.active_campaign.status === 'ARCHIVED' ? 'Reactivar' : 'Archivar'}
                  </button>
                )}
              </div>

              {/* Campaign Session State Controls */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {snapshot.campaign_sessions?.[0] && (
                  <span className="px-2.5 py-1 rounded-lg bg-[#090712] border border-violet-500/25 text-slate-300">
                    {snapshot.campaign_sessions[0].title}:{' '}
                    <strong
                      className={
                        snapshot.campaign_sessions[0].status === 'ACTIVE'
                          ? 'text-emerald-300'
                          : snapshot.campaign_sessions[0].status === 'PAUSED'
                            ? 'text-amber-300'
                            : 'text-slate-400'
                      }
                    >
                      {snapshot.campaign_sessions[0].status}
                    </strong>
                  </span>
                )}
                <input
                  type="text"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  placeholder="Nombre nueva sesión..."
                  className="w-36 px-2.5 py-1 rounded-lg bg-[#090712] border border-violet-500/25 text-slate-100 placeholder-slate-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    sendDMOverride({ action: 'START_CAMPAIGN_SESSION', session_title: newSessionTitle.trim() })
                    setNewSessionTitle('')
                  }}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1"
                  title="Iniciar nueva sesión preservando historial de campaña"
                >
                  <PlayCircle className="w-3.5 h-3.5" /> Nueva Sesión
                </button>
                <button
                  type="button"
                  onClick={() => sendDMOverride({ action: 'PAUSE_CAMPAIGN_SESSION' })}
                  className="px-2 py-1 rounded-lg bg-[#090712] border border-amber-500/30 text-amber-200 flex items-center gap-1"
                  title="Pausar sesión actual"
                >
                  <PauseCircle className="w-3.5 h-3.5" /> Pausar
                </button>
                <button
                  type="button"
                  onClick={() => sendDMOverride({ action: 'CLOSE_CAMPAIGN_SESSION' })}
                  className="px-2 py-1 rounded-lg bg-[#090712] border border-rose-500/30 text-rose-200 flex items-center gap-1"
                  title="Cerrar sesión sin borrar notas ni historial"
                >
                  <StopCircle className="w-3.5 h-3.5" /> Cerrar
                </button>
              </div>
            </div>

            {creatingCampaign && (
              <form
                onSubmit={handleCreateCampaign}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-violet-500/20 text-xs"
              >
                <input
                  type="text"
                  required
                  value={newCampName}
                  onChange={(e) => setNewCampName(e.target.value)}
                  placeholder="Nombre de nueva campaña (ej. Maldición de Strahd)"
                  className="sm:col-span-4 px-3 py-2 rounded-lg bg-[#090712] border border-violet-500/30 text-slate-100"
                />
                <input
                  type="text"
                  value={newCampSystem}
                  onChange={(e) => setNewCampSystem(e.target.value)}
                  placeholder="Sistema (D&D 5e / Pathfinder / Agnóstico)"
                  className="sm:col-span-3 px-3 py-2 rounded-lg bg-[#090712] border border-violet-500/30 text-slate-100"
                />
                <input
                  type="text"
                  value={newCampDesc}
                  onChange={(e) => setNewCampDesc(e.target.value)}
                  placeholder="Descripción breve (opcional)"
                  className="sm:col-span-3 px-3 py-2 rounded-lg bg-[#090712] border border-violet-500/30 text-slate-100"
                />
                <button
                  type="submit"
                  className="sm:col-span-2 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold"
                >
                  Crear Campaña
                </button>
              </form>
            )}
          </section>
        )}

        {/* Row 1: QR Connection Panel + Initiative & Turn Control */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* QR & LAN Connection Card */}
          <section className="lg:col-span-4 rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 sm:p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <h2 className="text-sm font-bold text-amber-200">Conexión de Jugadores en Red Local</h2>
                <button
                  type="button"
                  onClick={() => setQrHTTPS((prev) => !prev)}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold border transition ${
                    qrHTTPS
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-600'
                  }`}
                >
                  {qrHTTPS ? 'HTTPS (Sensores)' : 'HTTP'}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Los jugadores escanean este QR. En HTTPS funcionan el acelerómetro y hápticos en iOS/Android (si aparece aviso de certificado local, pulsar Avanzado → Continuar).
              </p>
            </div>

            <div className="flex flex-col items-center bg-white p-3.5 rounded-2xl w-fit mx-auto shadow-lg">
              <QRCodeSVG value={activeQRURL} size={148} level="M" />
            </div>

            <div className="space-y-2">
              {customQrURL && (
                <div className="flex items-center justify-between gap-2 bg-emerald-500/15 border border-emerald-400/40 rounded-lg px-2.5 py-1 text-[11px] text-emerald-200">
                  <span className="flex items-center gap-1 font-semibold truncate">
                    <Radio className="w-3 h-3 shrink-0" /> URL HTTPS Activa
                  </span>
                  <button
                    type="button"
                    onClick={() => setCustomQrURL(null)}
                    className="underline text-amber-200 hover:text-white shrink-0"
                  >
                    Volver a LAN
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 bg-[#090712] border border-violet-500/30 rounded-xl px-3 py-2">
                <span className="text-xs font-mono text-amber-200 truncate flex-1">{activeQRURL}</span>
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
              <button
                type="button"
                onClick={() => setCertModalOpen(true)}
                className="w-full py-2 px-3 rounded-xl bg-emerald-500/15 border border-emerald-400/45 hover:bg-emerald-500/25 text-[11px] font-bold text-emerald-200 flex items-center justify-center gap-1.5 transition"
              >
                <Lock className="w-3.5 h-3.5 text-amber-300" />
                Certificado HTTPS &amp; Túnel Público (2 Soluciones)
              </button>
              <a
                href={`http://${snapshot?.lan_ip || window.location.hostname}:${snapshot?.port || window.location.port || 8080}/api/v1/tls/ca.crt`}
                download="rollhaven-ca.crt"
                className="w-full py-1.5 px-3 rounded-xl bg-[#090712] border border-violet-500/30 hover:border-emerald-400/50 text-[11px] font-semibold text-violet-200 flex items-center justify-center gap-1.5 transition"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                Descarga Rápida CA Local (rollhaven-ca.crt)
              </a>
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
                            {p.membership_status === 'REVOKED' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold mr-1">
                                REVOCADA
                              </span>
                            )}
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
                                sendDMOverride({
                                  action: 'SET_MEMBERSHIP_STATUS',
                                  target_player_id: p.id,
                                  membership_status: p.membership_status === 'REVOKED' ? 'ACTIVE' : 'REVOKED',
                                })
                              }
                              className={`p-1.5 rounded inline-flex align-middle ${
                                p.membership_status === 'REVOKED'
                                  ? 'text-emerald-400 hover:bg-emerald-500/15'
                                  : 'text-amber-400 hover:bg-amber-500/15'
                              }`}
                              title={
                                p.membership_status === 'REVOKED'
                                  ? 'Reactivar membresía'
                                  : 'Revocar membresía (bloquear comandos)'
                              }
                            >
                              {p.membership_status === 'REVOKED' ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : (
                                <Ban className="w-3.5 h-3.5" />
                              )}
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
            roundNumber={snapshot.session.round_number ?? 1}
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
              onRoll={(payload) => sendMessage('ROLL_ACTION', { ...payload, pin: verifiedPIN })}
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

        {/* Row 2B: Companion Hub (Realtime Chat, Journal Notes & Weighted Roll Tables) + Backup & Audit */}
        {snapshot && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8">
              <CompanionHub
                campaign={snapshot.active_campaign}
                activeSession={snapshot.campaign_sessions?.[0]}
                players={snapshot.players}
                localPlayerID="dm"
                isDM
                dmPIN={verifiedPIN}
                messages={snapshot.chat_messages ?? []}
                notes={snapshot.campaign_notes ?? []}
                rollTables={snapshot.roll_tables ?? []}
                noteConflict={noteConflict}
                onClearNoteConflict={clearNoteConflict}
                onSendMessage={(evt, payload) => sendMessage(evt, payload)}
              />
            </div>

            <section className="lg:col-span-4 rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-violet-400" />
                  Respaldos SHA-256 &amp; Auditoría
                </h2>
              </div>

              <div className="space-y-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadProtected(
                      '/api/v1/backups/download',
                      `rollhaven-backup-${snapshot.active_campaign?.id || 'default'}.zip`
                    )
                  }
                  className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Descargar Backup Completo (.zip)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadProtected(
                      '/api/v1/campaigns/export',
                      `rollhaven-campaign-${snapshot.active_campaign?.id || 'default'}.json`
                    )
                  }
                  className="w-full py-2 px-3 rounded-xl bg-[#090712] border border-violet-500/30 hover:border-amber-400/60 text-amber-200 font-semibold flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Exportar Campaña Portable (.json)
                </button>
                <label className="w-full py-2 px-3 rounded-xl bg-[#090712] border border-emerald-500/35 hover:bg-emerald-950/30 text-emerald-200 font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" /> Restaurar Backup (.zip / .json)
                  <input
                    ref={restoreFileRef}
                    type="file"
                    accept=".zip,.json,application/zip,application/json"
                    onChange={handleRestoreFile}
                    className="hidden"
                  />
                </label>
                {backupStatus && (
                  <div className="text-[11px] text-amber-200 bg-[#090712] border border-violet-500/20 rounded-lg px-2.5 py-1.5">
                    {backupStatus}
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-violet-500/20">
                <h3 className="text-xs font-bold text-slate-300">Registro de Auditoría</h3>
                <div className="h-44 overflow-y-auto space-y-1.5 pr-1 text-[11px]">
                  {(snapshot.audit_events ?? []).length === 0 ? (
                    <div className="text-slate-500 italic py-4 text-center">Sin eventos administrativos aún.</div>
                  ) : (
                    (snapshot.audit_events ?? []).map((ev) => (
                      <div key={ev.id} className="p-2 rounded-lg bg-[#090712]/75 border border-white/5">
                        <div className="flex items-center justify-between gap-2 text-amber-300 font-semibold">
                          <span>{ev.action}</span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-slate-300 mt-0.5">{ev.summary}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Row 2.5 (v1.5.0): Fari Scene Cards & Clocks + Dungeoneer CR/Mob Controller & Web Audio Soundboard */}
        {snapshot && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Fari Scene Index Cards & Progress Clocks */}
            <section className="lg:col-span-6 rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  Tarjetas de Escena &amp; Relojes de Progreso (Fari)
                </h2>
                <span className="text-[11px] text-slate-400">Visible en todos los móviles</span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newCardTitle.trim()) return
                  const nextCards: SceneCard[] = [
                    ...(snapshot.session.scene_cards ?? []),
                    {
                      id: `card_${Date.now()}`,
                      title: newCardTitle.trim(),
                      subtitle: newCardSubtitle.trim(),
                      kind: newCardKind,
                      segments: newCardKind === 'clock' ? Math.max(2, Math.min(12, newCardSegments)) : 0,
                      filled: 0,
                    },
                  ]
                  sendDMOverride({ action: 'SET_SCENE_CARDS', scene_cards: nextCards })
                  setNewCardTitle('')
                  setNewCardSubtitle('')
                }}
                className="flex flex-wrap items-center gap-2 bg-[#090712]/70 p-2.5 rounded-xl border border-violet-500/20 text-xs"
              >
                <input
                  type="text"
                  value={newCardTitle}
                  onChange={(e) => setNewCardTitle(e.target.value)}
                  placeholder="Título (ej. Ritual Oscuro / Puente en Llamas)"
                  className="flex-1 min-w-[150px] bg-[#120d22] border border-violet-500/30 rounded-lg px-2.5 py-1.5 text-white"
                />
                <input
                  type="text"
                  value={newCardSubtitle}
                  onChange={(e) => setNewCardSubtitle(e.target.value)}
                  placeholder="Regla o detalle..."
                  className="flex-1 min-w-[130px] bg-[#120d22] border border-violet-500/30 rounded-lg px-2.5 py-1.5 text-slate-200"
                />
                <select
                  value={newCardKind}
                  onChange={(e) => setNewCardKind(e.target.value as 'aspect' | 'clock')}
                  className="bg-[#120d22] border border-violet-500/30 rounded-lg px-2 py-1.5 text-amber-200"
                >
                  <option value="clock">Reloj</option>
                  <option value="aspect">Aspecto</option>
                </select>
                {newCardKind === 'clock' && (
                  <select
                    value={newCardSegments}
                    onChange={(e) => setNewCardSegments(Number(e.target.value))}
                    className="bg-[#120d22] border border-violet-500/30 rounded-lg px-2 py-1.5 text-slate-200"
                  >
                    {[4, 6, 8, 10, 12].map((seg) => (
                      <option key={seg} value={seg}>
                        {seg} seg
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold"
                >
                  Fijar
                </button>
              </form>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {(snapshot.session.scene_cards?.length ?? 0) === 0 ? (
                  <p className="text-xs text-slate-500">
                    Fija aspectos ambientales o relojes de amenaza para que todo el grupo vea el progreso en vivo.
                  </p>
                ) : (
                  snapshot.session.scene_cards!.map((card) => (
                    <div
                      key={card.id}
                      className="rounded-xl border border-amber-400/25 bg-[#090712]/80 p-2.5 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-bold text-amber-200">{card.title}</span>
                          {card.subtitle && <span className="text-slate-400 ml-2">· {card.subtitle}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const remaining = (snapshot.session.scene_cards ?? []).filter((c) => c.id !== card.id)
                            sendDMOverride({ action: 'SET_SCENE_CARDS', scene_cards: remaining })
                          }}
                          className="text-slate-400 hover:text-rose-400 p-1"
                          title="Quitar tarjeta"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {card.kind === 'clock' && (
                        <div className="flex items-center gap-1.5">
                          {Array.from({ length: Math.max(2, card.segments) }).map((_, idx) => {
                            const activeSeg = idx < card.filled
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  const nextFilled = idx + 1 === card.filled ? idx : idx + 1
                                  const updated = (snapshot.session.scene_cards ?? []).map((c) =>
                                    c.id === card.id ? { ...c, filled: nextFilled } : c
                                  )
                                  sendDMOverride({ action: 'SET_SCENE_CARDS', scene_cards: updated })
                                }}
                                className={`h-2.5 flex-1 rounded-full transition ${
                                  activeSeg ? 'bg-amber-400' : 'bg-slate-800 hover:bg-slate-700'
                                }`}
                                title={`Segmento ${idx + 1}/${card.segments}`}
                              />
                            )
                          })}
                          <span className="font-mono text-[11px] text-amber-200 ml-1">
                            {card.filled}/{card.segments}
                          </span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Dungeoneer CR Encounter Calculator + Mob Controller + Web Audio Soundboard */}
            <section className="lg:col-span-6 rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                  <Swords className="w-4 h-4 text-rose-400" />
                  Calculadora CR, Hordas &amp; Soundboard
                </h2>
                <label className="text-[11px] text-slate-300 flex items-center gap-1.5">
                  Nivel Medio Grupo:
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={partyAvgLevel}
                    onChange={(e) => setPartyAvgLevel(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                    className="w-12 bg-[#090712] border border-violet-500/30 rounded px-1.5 py-0.5 text-amber-200 font-mono text-center"
                  />
                </label>
              </div>

              {(() => {
                const enemyXPs = (snapshot.map_entities ?? [])
                  .filter((e) => e.kind === 'enemy')
                  .map((e) => crToXP(`${e.name} ${e.note || ''}`))
                const evalRes = calculateEncounterDifficulty(Math.max(1, players.length), partyAvgLevel, enemyXPs)
                const badgeColor =
                  evalRes.label === 'Mortal'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : evalRes.label === 'Difícil'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : evalRes.label === 'Medio'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-300 border-slate-600'
                return (
                  <div className="rounded-xl bg-[#090712]/70 border border-violet-500/20 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="text-slate-400">Enemigos en mapa:</span>{' '}
                      <strong className="text-white">{enemyXPs.length}</strong>{' '}
                      <span className="text-slate-500">
                        ({evalRes.baseXP} XP ×{evalRes.mult} = <strong className="text-amber-200">{evalRes.adjustedXP} XP</strong>)
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${badgeColor}`}>
                      {evalRes.label} ({players.length || 1} PJ Nv.{partyAvgLevel})
                    </span>
                  </div>
                )
              })()}

              {/* Mob Controller (bulk attack + damage vs AC) */}
              <div className="rounded-xl bg-[#090712]/70 border border-violet-500/20 p-2.5 space-y-2 text-xs">
                <div className="text-[11px] font-bold uppercase tracking-wider text-rose-300">
                  Ataque de Horda (Mob Controller)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  <input
                    type="text"
                    value={mobName}
                    onChange={(e) => setMobName(e.target.value)}
                    placeholder="Nombre"
                    className="col-span-2 sm:col-span-1 bg-[#120d22] border border-violet-500/30 rounded px-2 py-1 text-white"
                  />
                  <label className="flex items-center gap-1 bg-[#120d22] border border-violet-500/30 rounded px-1.5 py-1 text-slate-300">
                    <span className="text-[10px]">#</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={mobCount}
                      onChange={(e) => setMobCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                      className="w-full bg-transparent text-amber-200 font-mono"
                    />
                  </label>
                  <label className="flex items-center gap-1 bg-[#120d22] border border-violet-500/30 rounded px-1.5 py-1 text-slate-300">
                    <span className="text-[10px]">+Atq</span>
                    <input
                      type="number"
                      value={mobAtkBonus}
                      onChange={(e) => setMobAtkBonus(Number(e.target.value) || 0)}
                      className="w-full bg-transparent text-white font-mono"
                    />
                  </label>
                  <label className="flex items-center gap-1 bg-[#120d22] border border-violet-500/30 rounded px-1.5 py-1 text-slate-300">
                    <span className="text-[10px]">CA</span>
                    <input
                      type="number"
                      value={mobTargetAC}
                      onChange={(e) => setMobTargetAC(Number(e.target.value) || 10)}
                      className="w-full bg-transparent text-white font-mono"
                    />
                  </label>
                  <input
                    type="text"
                    value={mobDmgNotation}
                    onChange={(e) => setMobDmgNotation(e.target.value)}
                    placeholder="1d6+2"
                    className="bg-[#120d22] border border-violet-500/30 rounded px-2 py-1 text-emerald-200 font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    sendDMOverride({
                      action: 'MOB_ROLL',
                      mob_name: mobName.trim() || 'Horda',
                      mob_count: mobCount,
                      mob_atk_bonus: mobAtkBonus,
                      mob_target_ac: mobTargetAC,
                      mob_dmg_notation: mobDmgNotation.trim() || '1d6+2',
                      mob_visibility: 'PUBLIC',
                    })
                  }
                  className="w-full py-1.5 rounded-lg bg-rose-600/85 hover:bg-rose-500 text-white font-bold transition"
                >
                  Lanzar {mobCount} ataques de {mobName || 'Horda'} vs CA {mobTargetAC}
                </button>
              </div>

              {/* Web Audio Tabletop Soundboard */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-300" />
                  Soundboard Sincronizado (Web Audio)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {SOUNDBOARD_CLIPS.map((clip) => (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => {
                        playTabletopSound(clip.id)
                        sendMessage('TEMPORARY_MAP_EVENT', {
                          kind: 'sound',
                          sound_id: clip.id,
                          label: clip.label,
                        })
                      }}
                      className="px-2 py-1.5 rounded-lg bg-[#090712] border border-violet-500/25 hover:border-emerald-400/50 text-[11px] text-slate-200 font-semibold truncate transition"
                    >
                      {clip.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

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

            {/* Ogres Multi-Scene Preset Bar & Fog of War Quick Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[#090712]/70 p-2.5 rounded-xl border border-violet-500/20 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    sendDMOverride({
                      action: 'UPDATE_FOG',
                      fog_enabled: !snapshot.session.fog_enabled,
                    })
                  }
                  className={`px-2.5 py-1.5 rounded-lg font-bold border flex items-center gap-1.5 transition ${
                    snapshot.session.fog_enabled
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                      : 'bg-[#120d22] border-violet-500/25 text-slate-300'
                  }`}
                >
                  <CloudFog className="w-3.5 h-3.5" />
                  {snapshot.session.fog_enabled ? 'Niebla: ACTIVA' : 'Niebla: OFF'}
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    sendDMOverride({
                      action: 'SAVE_SCENE',
                      scene_name: newSceneName.trim() || `Escena ${(snapshot.map_scenes?.length ?? 0) + 1}`,
                    })
                    setNewSceneName('')
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={newSceneName}
                    onChange={(e) => setNewSceneName(e.target.value)}
                    placeholder="Nombre de escena..."
                    className="w-36 sm:w-44 bg-[#120d22] border border-violet-500/30 rounded-lg px-2 py-1 text-white"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" /> Guardar Escena
                  </button>
                </form>
              </div>

              {(snapshot.map_scenes?.length ?? 0) > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400">Escenas:</span>
                  {snapshot.map_scenes!.map((sc) => (
                    <div
                      key={sc.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#120d22] border border-violet-500/30 px-2 py-1"
                    >
                      <button
                        type="button"
                        onClick={() => sendDMOverride({ action: 'ACTIVATE_SCENE', scene_id: sc.id })}
                        className="text-amber-200 hover:text-white font-semibold"
                        title={`Cargar ${sc.name} (${sc.map_cols}x${sc.map_rows})`}
                      >
                        {sc.name} ({sc.map_cols}×{sc.map_rows})
                      </button>
                      <button
                        type="button"
                        onClick={() => sendDMOverride({ action: 'DELETE_SCENE', scene_id: sc.id })}
                        className="text-slate-500 hover:text-rose-400"
                        title="Eliminar escena"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* DM Map Mode Switch + Entity Spawner (Enemies, Traps, Items, NPCs, Hazards, Doors) */}
            <div className="bg-[#090712]/75 rounded-xl p-3.5 border border-violet-500/20 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDmMapMode('move')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                      dmMapMode === 'move'
                        ? 'bg-violet-600 text-white'
                        : 'bg-[#120d22] text-slate-400 hover:text-slate-200 border border-violet-500/20'
                    }`}
                  >
                    <Hand className="w-3.5 h-3.5" /> Mover Fichas / Elementos
                  </button>
                  <button
                    type="button"
                    onClick={() => setDmMapMode('place')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                      dmMapMode === 'place'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-[#120d22] text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" /> Colocar Elemento en Clic
                  </button>
                </div>

                {(snapshot.map_entities?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => sendDMOverride({ action: 'CLEAR_MAP_ENTITIES' })}
                    className="text-[11px] text-rose-300 hover:text-rose-200 underline"
                  >
                    Limpiar todos ({snapshot.map_entities.length})
                  </button>
                )}
              </div>

              {/* Category selector & Presets */}
              <div className="flex flex-wrap gap-1.5">
                {ENTITY_CATEGORIES.map((cat) => {
                  const active = entityKind === cat.kind
                  const IconComp =
                    cat.kind === 'enemy'
                      ? Skull
                      : cat.kind === 'trap'
                        ? AlertTriangle
                        : cat.kind === 'item'
                          ? Gem
                          : cat.kind === 'npc'
                            ? Shield
                            : cat.kind === 'hazard'
                              ? Flame
                              : DoorOpen
                  return (
                    <button
                      key={cat.kind}
                      type="button"
                      onClick={() => {
                        setEntityKind(cat.kind)
                        setEntityColor(cat.defaultColor)
                        const first = cat.presets[0]
                        if (first) {
                          setEntityName(first.name)
                          setEntityHP(String(first.hp))
                          setEntitySize(first.size)
                          setEntityNote(first.note)
                        }
                        setEntityHidden(cat.kind === 'trap')
                        setDmMapMode('place')
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
                        active
                          ? 'border-amber-400 bg-violet-900/60 text-amber-100'
                          : 'border-violet-500/20 bg-[#120d22] text-slate-300 hover:border-violet-400/50'
                      }`}
                    >
                      <IconComp className="w-3.5 h-3.5" style={{ color: cat.defaultColor }} />
                      {cat.label}
                    </button>
                  )
                })}
              </div>

              {/* Quick Presets for active category */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-400 mr-1">Presets rápidos:</span>
                {ENTITY_CATEGORIES.find((c) => c.kind === entityKind)?.presets.map((pr) => (
                  <button
                    key={pr.name}
                    type="button"
                    onClick={() => {
                      setEntityName(pr.name)
                      setEntityHP(String(pr.hp))
                      setEntitySize(pr.size)
                      setEntityNote(pr.note)
                      setDmMapMode('place')
                    }}
                    className="px-2 py-0.5 rounded bg-[#120d22] border border-violet-500/25 text-violet-200 hover:border-amber-400"
                  >
                    {pr.name}
                  </button>
                ))}
              </div>

              {/* Custom fields for next placed entity */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
                <input
                  type="text"
                  value={entityName}
                  onChange={(e) => setEntityName(e.target.value)}
                  placeholder="Nombre (ej. Jefe Goblin)"
                  className="col-span-2 sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100"
                />
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={entityHP}
                  onChange={(e) => setEntityHP(e.target.value)}
                  placeholder="HP"
                  className="px-2.5 py-1.5 rounded-lg bg-[#120d22] border border-violet-500/25 text-amber-200 font-mono"
                />
                <select
                  value={entitySize}
                  onChange={(e) => setEntitySize(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100"
                >
                  <option value={1}>Tamaño 1×1</option>
                  <option value={2}>Grande 2×2</option>
                  <option value={3}>Enorme 3×3</option>
                  <option value={4}>Garg. 4×4</option>
                </select>
                <input
                  type="text"
                  value={entityNote}
                  onChange={(e) => setEntityNote(e.target.value)}
                  placeholder="Nota / DC / AC"
                  className="col-span-2 sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={entityHidden}
                    onChange={(e) => setEntityHidden(e.target.checked)}
                    className="rounded accent-violet-500"
                  />
                  Oculto a jugadores (ideal para trampas / emboscadas)
                </label>
                <span className="text-[11px] text-emerald-300/90">
                  {dmMapMode === 'place'
                    ? '✓ Haz clic en cualquier celda del mapa abajo para colocar'
                    : 'Cambia a "Colocar Elemento en Clic" para añadir en el mapa'}
                </span>
              </div>
            </div>

            {/* Selectable Players & Placed Entities Strip */}
            {(players.length > 0 || (snapshot.map_entities?.length ?? 0) > 0) && (
              <div className="space-y-2">
                {players.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400 mr-1">Jugadores:</span>
                    {players.map((p) => {
                      const selected = selectedTarget?.kind === 'player' && selectedTarget.id === p.id
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
                            onClick={() => {
                              setSelectedTarget({ kind: 'player', id: p.id })
                              setDmMapMode('move')
                            }}
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

                {(snapshot.map_entities?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400 mr-1">Elementos en Mapa:</span>
                    {snapshot.map_entities.map((ent) => {
                      const selected = selectedTarget?.kind === 'entity' && selectedTarget.id === ent.id
                      return (
                        <div
                          key={ent.id}
                          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 border text-xs ${
                            selected
                              ? 'border-amber-400 bg-violet-900/50 text-amber-100'
                              : 'border-violet-500/20 bg-[#090712]/70 text-slate-300'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTarget({ kind: 'entity', id: ent.id })
                              setDmMapMode('move')
                            }}
                            className="flex items-center gap-1.5 font-semibold"
                          >
                            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: ent.color_hex }} />
                            <span>{ent.name}</span>
                            {ent.note && <span className="text-[10px] text-slate-400">({ent.note})</span>}
                          </button>

                          {ent.hp_max > 0 && (
                            <div className="flex items-center gap-1 ml-1 bg-black/40 px-1.5 py-0.5 rounded">
                              <button
                                type="button"
                                onClick={() =>
                                  sendDMOverride({
                                    action: 'UPDATE_MAP_ENTITY',
                                    entity_id: ent.id,
                                    entity_hp_current: Math.max(0, ent.hp_current - 1),
                                  })
                                }
                                className="text-rose-300 font-bold px-1"
                              >
                                -
                              </button>
                              <span className="font-mono text-[11px] text-emerald-300">
                                {ent.hp_current}/{ent.hp_max}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  sendDMOverride({
                                    action: 'UPDATE_MAP_ENTITY',
                                    entity_id: ent.id,
                                    entity_hp_current: ent.hp_current + 1,
                                  })
                                }
                                className="text-emerald-300 font-bold px-1"
                              >
                                +
                              </button>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setEntityTacticalOpenID((prev) => (prev === ent.id ? null : ent.id))
                            }
                            title="Estados y Aura del elemento"
                            className={`text-xs px-1 rounded ${
                              (ent.conditions?.length ?? 0) > 0 || (ent.aura_radius ?? 0) > 0
                                ? 'text-amber-300 bg-amber-500/15'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            ⚡{(ent.conditions?.length ?? 0) > 0 ? ent.conditions!.length : ''}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              sendDMOverride({
                                action: 'UPDATE_MAP_ENTITY',
                                entity_id: ent.id,
                                entity_hidden: !ent.is_hidden,
                              })
                            }
                            title={ent.is_hidden ? 'Revelar a jugadores' : 'Ocultar a jugadores'}
                            className="text-slate-400 hover:text-white ml-0.5"
                          >
                            {ent.is_hidden ? <EyeOff className="w-3.5 h-3.5 text-rose-400" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => sendDMOverride({ action: 'DELETE_MAP_ENTITY', entity_id: ent.id })}
                            title="Eliminar del mapa"
                            className="text-slate-400 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )
                    })}

                    {entityTacticalOpenID &&
                      (() => {
                        const targetEnt = snapshot.map_entities.find((e) => e.id === entityTacticalOpenID)
                        if (!targetEnt) return null
                        const curConds = targetEnt.conditions ?? []
                        return (
                          <div className="w-full mt-1 rounded-xl bg-[#090712]/90 border border-amber-400/35 p-2.5 space-y-2 text-[11px]">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-amber-200">
                                Estados &amp; Aura de {targetEnt.name}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-400">Aura (ft):</span>
                                {[0, 10, 15, 20, 30].map((r) => (
                                  <button
                                    key={r}
                                    type="button"
                                    onClick={() =>
                                      sendDMOverride({
                                        action: 'UPDATE_ENTITY_TACTICAL',
                                        entity_id: targetEnt.id,
                                        conditions: curConds,
                                        aura_radius: r,
                                        aura_color: targetEnt.aura_color || targetEnt.color_hex,
                                      })
                                    }
                                    className={`px-1.5 py-0.5 rounded font-mono ${
                                      (targetEnt.aura_radius ?? 0) === r
                                        ? 'bg-amber-400 text-slate-950 font-bold'
                                        : 'bg-[#120d22] text-slate-300 border border-violet-500/20'
                                    }`}
                                  >
                                    {r === 0 ? 'OFF' : `${r}ft`}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {DND_CONDITIONS.map((cond) => {
                                const has = curConds.includes(cond.id)
                                return (
                                  <button
                                    key={cond.id}
                                    type="button"
                                    title={cond.summary}
                                    onClick={() => {
                                      const next = has
                                        ? curConds.filter((id) => id !== cond.id)
                                        : [...curConds, cond.id]
                                      sendDMOverride({
                                        action: 'UPDATE_ENTITY_TACTICAL',
                                        entity_id: targetEnt.id,
                                        conditions: next,
                                        aura_radius: targetEnt.aura_radius ?? 0,
                                        aura_color: targetEnt.aura_color || targetEnt.color_hex,
                                      })
                                    }}
                                    className={`px-1.5 py-0.5 rounded border transition ${
                                      has
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-100 font-bold'
                                        : 'border-violet-500/20 bg-[#120d22] text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    {cond.label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}
                  </div>
                )}
              </div>
            )}

            <TacticalMapCanvas
              session={snapshot.session}
              players={snapshot.players}
              entities={snapshot.map_entities ?? []}
              tempEvents={tempEvents}
              localPlayerID=""
              activePlayerID={snapshot.active_player_id}
              localPlayerName="Dungeon Master"
              localColor="#f59e0b"
              isDM
              dmMode={dmMapMode}
              selectedDMTarget={selectedTarget}
              onMoveToken={(pid, x, y) =>
                sendDMOverride({ action: 'MOVE_ANY_TOKEN', target_player_id: pid, target_x: x, target_y: y })
              }
              onTempEvent={(ev) => sendMessage('TEMPORARY_MAP_EVENT', ev)}
              onUpdateFog={(enabled, revealed) =>
                sendDMOverride({ action: 'UPDATE_FOG', fog_enabled: enabled, fog_revealed: revealed })
              }
              onCellClick={(x, y) => {
                if (dmMapMode === 'place') {
                  const hpParsed = Number.parseInt(entityHP, 10)
                  const hpVal = Number.isNaN(hpParsed) ? 0 : Math.max(0, hpParsed)
                  sendDMOverride({
                    action: 'ADD_MAP_ENTITY',
                    entity_kind: entityKind,
                    entity_name: entityName.trim() || 'Elemento',
                    entity_size: entitySize,
                    entity_color: entityColor,
                    entity_hp_current: hpVal,
                    entity_hp_max: hpVal,
                    entity_note: entityNote.trim(),
                    entity_hidden: entityHidden,
                    target_x: x,
                    target_y: y,
                  })
                } else if (selectedTarget?.kind === 'player') {
                  sendDMOverride({
                    action: 'MOVE_ANY_TOKEN',
                    target_player_id: selectedTarget.id,
                    target_x: x,
                    target_y: y,
                  })
                } else if (selectedTarget?.kind === 'entity') {
                  sendDMOverride({
                    action: 'MOVE_MAP_ENTITY',
                    entity_id: selectedTarget.id,
                    target_x: x,
                    target_y: y,
                  })
                }
              }}
            />
          </section>
        )}
      </main>

      <CertificateModal
        open={certModalOpen}
        onClose={() => setCertModalOpen(false)}
        isDM
        dmPIN={verifiedPIN}
        onUsePublicURL={(url) => setCustomQrURL(url)}
        onUseLocalHTTPS={(url) => setCustomQrURL(url)}
      />
    </div>
  )
}
