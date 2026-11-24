import React, { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Crown,
  Dices,
  Edit3,
  Eye,
  EyeOff,
  Lock,
  MessageSquare,
  Plus,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import {
  Campaign,
  CampaignNote,
  CampaignSession,
  ChatMessage,
  ChatVisibility,
  NoteVisibility,
  Player,
  RollTable,
  RollVisibility,
} from '../types'

interface CompanionHubProps {
  campaign?: Campaign
  activeSession?: CampaignSession
  players: Player[]
  localPlayerID: string
  isDM?: boolean
  dmPIN?: string
  messages: ChatMessage[]
  notes: CampaignNote[]
  rollTables: RollTable[]
  noteConflict?: string | null
  onClearNoteConflict?: () => void
  onSendMessage: (event: string, payload: Record<string, unknown>) => void
}

type CompanionTab = 'CHAT' | 'NOTES' | 'TABLES'

const NOTE_CATEGORIES = ['Diario', 'Pista', 'Lore', 'PNJ', 'Misión'] as const

function genCmdID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const CompanionHub: React.FC<CompanionHubProps> = ({
  campaign,
  activeSession,
  players,
  localPlayerID,
  isDM = false,
  dmPIN = '',
  messages,
  notes,
  rollTables,
  noteConflict,
  onClearNoteConflict,
  onSendMessage,
}) => {
  const [subTab, setSubTab] = useState<CompanionTab>('CHAT')

  // Chat state
  const [chatText, setChatText] = useState('')
  const [chatVisibility, setChatVisibility] = useState<ChatVisibility>('CAMPAIGN')
  const [chatRecipients, setChatRecipients] = useState<string[]>([])
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  // Notes state
  const [noteCategoryFilter, setNoteCategoryFilter] = useState<string>('ALL')
  const [editingNoteID, setEditingNoteID] = useState<string | null>(null)
  const [creatingNote, setCreatingNote] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [noteCategory, setNoteCategory] = useState<string>('Diario')
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>(isDM ? 'CAMPAIGN' : 'PRIVATE')
  const [noteRecipients, setNoteRecipients] = useState<string[]>([])
  const [noteAllowEdit, setNoteAllowEdit] = useState(false)
  const [noteExpectedVer, setNoteExpectedVer] = useState(1)

  // Roll Table state
  const [tableVisibility, setTableVisibility] = useState<RollVisibility>('PUBLIC')
  const [creatingTable, setCreatingTable] = useState(false)
  const [tableName, setTableName] = useState('')
  const [tableDesc, setTableDesc] = useState('')
  const [tableRowsText, setTableRowsText] = useState('Monedas de oro (3d10) | 40\nGema arcana | 25\nEmbestida sorpresa | 20\nReliquia olvidada | 15')

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages.length])

  const dmAuthExtra = isDM ? { as_dm: true, pin: dmPIN } : {}

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatText.trim()) return
    onSendMessage('CHAT_SEND', {
      body: chatText.trim(),
      visibility: chatVisibility,
      recipient_ids: chatVisibility === 'SELECTED_USERS' ? chatRecipients : [],
      command_id: genCmdID(),
      ...dmAuthExtra,
    })
    setChatText('')
  }

  const toggleIDInList = (id: string, list: string[], setter: (next: string[]) => void) => {
    if (list.includes(id)) {
      setter(list.filter((x) => x !== id))
    } else {
      setter([...list, id])
    }
  }

  const openCreateNote = () => {
    setEditingNoteID(null)
    setCreatingNote(true)
    setNoteTitle('')
    setNoteBody('')
    setNoteCategory('Diario')
    setNoteVisibility(isDM ? 'CAMPAIGN' : 'PRIVATE')
    setNoteRecipients([])
    setNoteAllowEdit(false)
    setNoteExpectedVer(1)
    onClearNoteConflict?.()
  }

  const openEditNote = (n: CampaignNote) => {
    setCreatingNote(false)
    setEditingNoteID(n.id)
    setNoteTitle(n.title)
    setNoteBody(n.body)
    setNoteCategory(n.category || 'Diario')
    setNoteVisibility((n.visibility as NoteVisibility) || 'PRIVATE')
    setNoteRecipients(n.recipient_ids ?? [])
    setNoteAllowEdit(n.allow_edit)
    setNoteExpectedVer(n.version)
    onClearNoteConflict?.()
  }

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault()
    if (!noteTitle.trim()) return
    if (editingNoteID) {
      onSendMessage('NOTE_UPDATE', {
        note_id: editingNoteID,
        expected_version: noteExpectedVer,
        title: noteTitle.trim(),
        body: noteBody,
        category: noteCategory,
        visibility: noteVisibility,
        recipient_ids: noteVisibility === 'SELECTED_USERS' ? noteRecipients : [],
        allow_edit: noteAllowEdit,
        ...dmAuthExtra,
      })
      setEditingNoteID(null)
    } else {
      onSendMessage('NOTE_CREATE', {
        title: noteTitle.trim(),
        body: noteBody,
        category: noteCategory,
        visibility: noteVisibility,
        recipient_ids: noteVisibility === 'SELECTED_USERS' ? noteRecipients : [],
        allow_edit: noteAllowEdit,
        ...dmAuthExtra,
      })
      setCreatingNote(false)
    }
  }

  const handleCreateTable = (e: React.FormEvent) => {
    e.preventDefault()
    if (!tableName.trim()) return
    const entries = tableRowsText
      .split('\n')
      .map((line, i) => {
        const parts = line.split('|').map((p) => p.trim())
        const label = parts[0] || ''
        const weight = parts[1] ? Number.parseInt(parts[1], 10) || 10 : 10
        return { id: `e_${i + 1}`, label, weight: Math.max(1, weight) }
      })
      .filter((x) => x.label.length > 0)
    if (entries.length === 0) return

    onSendMessage('DM_OVERRIDE', {
      action: 'CREATE_ROLL_TABLE',
      table_name: tableName.trim(),
      table_desc: tableDesc.trim(),
      table_entries: entries,
      pin: dmPIN,
    })
    setTableName('')
    setTableDesc('')
    setCreatingTable(false)
  }

  const filteredNotes = notes.filter((n) => {
    if (noteCategoryFilter === 'ALL') return true
    return n.category === noteCategoryFilter
  })

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-3.5 sm:p-5 space-y-4">
      {/* Campaign Context Banner + Companion Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-500/20 pb-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-violet-400" />
            {campaign?.name || 'Crónicas de Rollhaven'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {activeSession ? `${activeSession.title} (${activeSession.status})` : 'Sesión activa'} ·{' '}
            {campaign?.system_name || 'Universal'}
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-[#090712]/80 p-1 rounded-xl border border-violet-500/20">
          <button
            type="button"
            onClick={() => setSubTab('CHAT')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              subTab === 'CHAT' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Chat ({messages.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('NOTES')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              subTab === 'NOTES' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Diarios ({notes.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('TABLES')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              subTab === 'TABLES' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Dices className="w-3.5 h-3.5" />
            Tablas ({rollTables.length})
          </button>
        </div>
      </div>

      {/* TAB 1: REALTIME TABLE CHAT & WHISPERS */}
      {subTab === 'CHAT' && (
        <div className="space-y-3">
          <div className="h-64 overflow-y-auto space-y-2 pr-1 bg-[#090712]/65 rounded-xl p-3 border border-violet-500/20">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400 text-center px-4">
                Aún no hay mensajes en esta campaña. Escribe aquí o usa <code className="mx-1 text-amber-300">/roll 2d6+3</code> para tirar desde el chat.
              </div>
            ) : (
              messages.map((m) => {
                const isSelf = m.author_id === (isDM ? 'dm' : localPlayerID)
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl p-2.5 border text-xs ${
                      m.visibility === 'GM_WHISPER'
                        ? 'bg-amber-950/30 border-amber-500/35'
                        : m.visibility === 'SELECTED_USERS'
                          ? 'bg-violet-950/35 border-violet-400/35'
                          : isSelf
                            ? 'bg-indigo-950/40 border-violet-500/30'
                            : 'bg-[#120d22]/85 border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.author_color || '#a855f7' }} />
                        <span className="font-bold text-amber-200 flex items-center gap-1">
                          {m.author_role === 'GM' && <Crown className="w-3 h-3 text-amber-400" />}
                          {m.author_name}
                        </span>
                        {m.visibility === 'GM_WHISPER' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                            Susurro al GM
                          </span>
                        )}
                        {m.visibility === 'SELECTED_USERS' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-semibold">
                            Privado
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-slate-500">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isDM && (
                          <button
                            type="button"
                            onClick={() =>
                              onSendMessage('DM_OVERRIDE', { action: 'DELETE_CHAT_MESSAGE', message_id: m.id, pin: dmPIN })
                            }
                            className="text-slate-500 hover:text-rose-400"
                            title="Moderar / eliminar mensaje"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-slate-100 whitespace-pre-wrap break-words">{m.body}</div>
                  </div>
                )
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat audience selector */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-400 mr-1">Destinatarios:</span>
              {(['CAMPAIGN', 'GM_WHISPER', 'SELECTED_USERS'] as ChatVisibility[]).map((vis) => (
                <button
                  key={vis}
                  type="button"
                  onClick={() => setChatVisibility(vis)}
                  className={`px-2.5 py-1 rounded-lg border font-semibold transition ${
                    chatVisibility === vis
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-violet-500/20 bg-[#090712] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {vis === 'CAMPAIGN' ? 'Toda la Mesa' : vis === 'GM_WHISPER' ? 'Susurro al GM' : 'Elegir Jugadores'}
                </button>
              ))}
            </div>

            {chatVisibility === 'SELECTED_USERS' && (
              <div className="flex flex-wrap gap-1.5 bg-[#090712]/70 p-2 rounded-xl border border-violet-500/20">
                {players.map((p) => {
                  const chosen = chatRecipients.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleIDInList(p.id, chatRecipients, setChatRecipients)}
                      className={`px-2 py-1 rounded-lg text-[11px] border ${
                        chosen
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                          : 'border-violet-500/20 text-slate-400'
                      }`}
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>
            )}

            <form onSubmit={handleChatSubmit} className="flex gap-2">
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Mensaje a la mesa o comando /roll 2d20kh1..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#090712] border border-violet-500/30 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Enviar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: SHARED & PRIVATE JOURNAL NOTES WITH VERSIONING */}
      {subTab === 'NOTES' && (
        <div className="space-y-3">
          {noteConflict && (
            <div className="rounded-xl bg-amber-950/70 border border-amber-400/50 px-3 py-2 text-xs text-amber-200 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                {noteConflict}
              </span>
              <button type="button" onClick={onClearNoteConflict} className="underline shrink-0">
                Entendido
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {['ALL', ...NOTE_CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setNoteCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                    noteCategoryFilter === cat
                      ? 'bg-violet-600 text-white'
                      : 'bg-[#090712] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat === 'ALL' ? 'Todas' : cat}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={openCreateNote}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-bold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Nueva Nota / Handout
            </button>
          </div>

          {(creatingNote || editingNoteID) && (
            <form onSubmit={handleSaveNote} className="bg-[#090712]/80 rounded-xl p-3.5 border border-violet-500/35 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-200">
                  {editingNoteID ? `Editar Nota (v${noteExpectedVer})` : 'Nueva Entrada de Diario'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingNote(false)
                    setEditingNoteID(null)
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Título (ej. Mapa del Culto, Pista #2)"
                  className="sm:col-span-2 px-3 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100"
                />
                <select
                  value={noteCategory}
                  onChange={(e) => setNoteCategory(e.target.value)}
                  className="px-2.5 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100"
                >
                  {NOTE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={4}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Contenido de la nota, descripción de pistas, lore o acuerdos..."
                className="w-full px-3 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100 leading-relaxed"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400">Audiencia:</span>
                  {(['PRIVATE', 'GM_SHARED', 'CAMPAIGN', 'SELECTED_USERS'] as NoteVisibility[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setNoteVisibility(v)}
                      className={`px-2 py-1 rounded-lg border text-[11px] ${
                        noteVisibility === v
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                          : 'border-violet-500/20 text-slate-400'
                      }`}
                    >
                      {v === 'PRIVATE'
                        ? 'Privada'
                        : v === 'GM_SHARED'
                          ? 'Tú + GM'
                          : v === 'CAMPAIGN'
                            ? 'Toda la Campaña'
                            : 'Seleccionados'}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noteAllowEdit}
                    onChange={(e) => setNoteAllowEdit(e.target.checked)}
                    className="rounded accent-violet-500"
                  />
                  Permitir edición colaborativa
                </label>
              </div>

              {noteVisibility === 'SELECTED_USERS' && (
                <div className="flex flex-wrap gap-1.5 bg-[#120d22] p-2 rounded-lg border border-violet-500/20">
                  {players.map((p) => {
                    const checked = noteRecipients.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleIDInList(p.id, noteRecipients, setNoteRecipients)}
                        className={`px-2 py-1 rounded text-[11px] border ${
                          checked
                            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                            : 'border-violet-500/20 text-slate-400'
                        }`}
                      >
                        {p.name}
                      </button>
                    )
                  })}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
              >
                {editingNoteID ? 'Guardar Cambios (Verificar Versión)' : 'Publicar Nota'}
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {filteredNotes.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 bg-[#090712]/50 rounded-xl border border-dashed border-violet-500/20">
                No hay notas visibles en esta categoría.
              </div>
            ) : (
              filteredNotes.map((n) => {
                const isOwner = n.owner_id === (isDM ? 'dm' : localPlayerID)
                const canEdit = isOwner || (isDM && n.visibility !== 'PRIVATE') || n.allow_edit
                return (
                  <div key={n.id} className="rounded-xl p-3 bg-[#090712]/75 border border-violet-500/20 space-y-1.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-amber-200 text-sm">{n.title}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">
                            {n.category}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 inline-flex items-center gap-1">
                            {n.visibility === 'PRIVATE' ? (
                              <Lock className="w-2.5 h-2.5 text-rose-400" />
                            ) : n.visibility === 'CAMPAIGN' ? (
                              <Eye className="w-2.5 h-2.5 text-emerald-400" />
                            ) : n.visibility === 'GM_SHARED' ? (
                              <Shield className="w-2.5 h-2.5 text-amber-400" />
                            ) : (
                              <Users className="w-2.5 h-2.5 text-sky-400" />
                            )}
                            {n.visibility}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">v{n.version}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Autor: {n.owner_name} {n.allow_edit ? '· Edición colaborativa' : ''}
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditNote(n)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300"
                            title="Editar nota"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {(isOwner || (isDM && n.visibility !== 'PRIVATE')) && (
                            <button
                              type="button"
                              onClick={() => onSendMessage('NOTE_DELETE', { note_id: n.id, ...dmAuthExtra })}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400"
                              title="Eliminar nota"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {n.body && <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">{n.body}</p>}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: RANDOM WEIGHTED ROLL TABLES (P1) */}
      {subTab === 'TABLES' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Visibilidad al tirar:</span>
              {(['PUBLIC', 'GM_ONLY', 'ROLLER_AND_GM'] as RollVisibility[]).map((vis) => (
                <button
                  key={vis}
                  type="button"
                  onClick={() => setTableVisibility(vis)}
                  className={`px-2 py-1 rounded-lg border text-[11px] font-semibold ${
                    tableVisibility === vis
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-violet-500/20 bg-[#090712] text-slate-400'
                  }`}
                >
                  {vis === 'PUBLIC' ? (
                    <span className="inline-flex items-center gap-1">
                      <Eye className="w-3 h-3" /> Pública
                    </span>
                  ) : vis === 'GM_ONLY' ? (
                    <span className="inline-flex items-center gap-1">
                      <EyeOff className="w-3 h-3" /> Solo GM
                    </span>
                  ) : (
                    'Autor + GM'
                  )}
                </button>
              ))}
            </div>
            {isDM && (
              <button
                type="button"
                onClick={() => setCreatingTable((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> {creatingTable ? 'Cerrar' : 'Nueva Tabla'}
              </button>
            )}
          </div>

          {isDM && creatingTable && (
            <form onSubmit={handleCreateTable} className="bg-[#090712]/80 rounded-xl p-3.5 border border-violet-500/35 space-y-2.5 text-xs">
              <input
                type="text"
                required
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="Nombre de la tabla (ej. Críticos Arcanos)"
                className="w-full px-3 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100"
              />
              <input
                type="text"
                value={tableDesc}
                onChange={(e) => setTableDesc(e.target.value)}
                placeholder="Descripción breve (opcional)"
                className="w-full px-3 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100"
              />
              <textarea
                rows={4}
                value={tableRowsText}
                onChange={(e) => setTableRowsText(e.target.value)}
                placeholder="Resultado | Peso (uno por línea)"
                className="w-full px-3 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-slate-100 font-mono"
              />
              <button type="submit" className="w-full py-2 rounded-xl bg-amber-500 text-slate-950 font-bold">
                Crear Tabla Ponderada
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rollTables.map((rt) => (
              <div key={rt.id} className="rounded-xl p-3.5 bg-[#090712]/75 border border-violet-500/25 flex flex-col justify-between space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-amber-200">{rt.name}</h4>
                      {rt.description && <p className="text-[11px] text-slate-400">{rt.description}</p>}
                    </div>
                    {isDM && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendMessage('DM_OVERRIDE', { action: 'DELETE_ROLL_TABLE', table_id: rt.id, pin: dmPIN })
                        }
                        className="text-slate-500 hover:text-rose-400"
                        title="Eliminar tabla"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1 text-[11px]">
                    {rt.entries.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-slate-300 bg-[#120d22]/80 px-2 py-1 rounded">
                        <span className="truncate">{e.label}</span>
                        <span className="text-[10px] font-mono text-amber-300 shrink-0">peso {e.weight}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onSendMessage('ROLL_TABLE_EXEC', {
                      table_id: rt.id,
                      visibility: tableVisibility,
                      ...dmAuthExtra,
                    })
                  }
                  className="w-full py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Lanzar Tabla Aleatoria
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
