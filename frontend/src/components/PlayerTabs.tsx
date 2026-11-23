import React, { useEffect, useRef, useState } from 'react'
import { Backpack, FileText, NotebookPen, Plus, Search, Trash2, Upload, X, ZoomIn } from 'lucide-react'
import { Player } from '../types'
import { RACES, RaceSVG, TOKEN_COLORS, getRaceLabel } from './RaceIcons'

interface CharacterSheetAndRaceTabProps {
  player: Player
  onUpdateProfile: (patch: { name?: string; initiative?: number; race?: string; color?: string }) => void
}

export const CharacterSheetAndRaceTab: React.FC<CharacterSheetAndRaceTabProps> = ({
  player,
  onUpdateProfile,
}) => {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('El archivo supera el límite de 10 MB.')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('player_id', player.id)
      form.append('file', file)
      const res = await fetch('/api/v1/upload/sheet', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setUploadError(data.error || 'Error subiendo hoja de personaje')
      }
    } catch {
      setUploadError('No se pudo conectar al servidor para subir la hoja')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const isPDF = player.character_sheet_path?.toLowerCase().endsWith('.pdf')

  return (
    <div className="space-y-4">
      {/* Race & Token Color Picker */}
      <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
            <RaceSVG race={player.race_icon} color={player.color_hex} className="w-5 h-5" />
            Raza y Apariencia ({getRaceLabel(player.race_icon)})
          </h3>
          <span className="text-[11px] text-slate-400">Sincronizado en vivo</span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {RACES.map((r) => {
            const active = player.race_icon === r.id
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onUpdateProfile({ race: r.id })}
                className={`flex flex-col items-center p-2.5 rounded-xl border text-xs transition ${
                  active
                    ? 'border-amber-400 bg-violet-900/50 text-amber-200 shadow-md shadow-violet-950'
                    : 'border-violet-500/20 bg-[#090712]/60 text-slate-400 hover:border-violet-400/50 hover:text-slate-200'
                }`}
              >
                <RaceSVG race={r.id} color={active ? player.color_hex : '#a78bfa'} className="w-6 h-6 mb-1" />
                <span className="font-semibold truncate w-full text-center">{r.label}</span>
                <span className="text-[10px] text-slate-500 truncate w-full text-center">{r.subtitle}</span>
              </button>
            )
          })}
        </div>

        <div className="pt-1">
          <div className="text-xs font-semibold text-slate-400 mb-2">Color de Ficha en el Mapa</div>
          <div className="flex flex-wrap gap-2.5">
            {TOKEN_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onUpdateProfile({ color: hex })}
                style={{ backgroundColor: hex }}
                className={`w-8 h-8 rounded-full transition transform ${
                  player.color_hex === hex ? 'ring-2 ring-white scale-110 shadow-lg' : 'opacity-70 hover:opacity-100'
                }`}
                aria-label={`Color ${hex}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Character Sheet Upload & Integrated Viewer */}
      <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
            <FileText className="w-4 h-4 text-violet-400" />
            Hoja de Personaje (PDF / Imagen, máx. 10 MB)
          </h3>
          <label className="cursor-pointer px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5 transition">
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Subiendo...' : player.character_sheet_path ? 'Reemplazar Hoja' : 'Subir Hoja'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              onChange={handleUpload}
              className="hidden"
            />
          </label>
        </div>

        {uploadError && (
          <div className="text-xs text-rose-300 bg-rose-950/60 border border-rose-500/40 rounded-lg px-3 py-2">
            {uploadError}
          </div>
        )}

        {player.character_sheet_path ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300 bg-[#090712]/70 px-3 py-2 rounded-xl border border-violet-500/20">
              <span className="truncate font-mono">{player.character_sheet_path.split('/').pop()}</span>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="text-amber-300 hover:text-amber-200 font-semibold flex items-center gap-1 shrink-0 ml-2"
              >
                <ZoomIn className="w-3.5 h-3.5" /> Pantalla completa
              </button>
            </div>
            <div className="rounded-xl overflow-hidden border border-violet-500/20 bg-[#090712]">
              {isPDF ? (
                <iframe
                  src={player.character_sheet_path}
                  title="Hoja de Personaje PDF"
                  className="w-full h-[420px]"
                />
              ) : (
                <img
                  src={player.character_sheet_path}
                  alt="Hoja de Personaje"
                  onClick={() => setModalOpen(true)}
                  className="w-full max-h-[420px] object-contain cursor-zoom-in"
                />
              )}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400 bg-[#090712]/60 rounded-xl border border-dashed border-violet-500/25">
            Aún no has subido tu hoja de personaje. Puedes subir un archivo PDF o una foto PNG/JPG.
          </div>
        )}
      </div>

      {/* Fullscreen Sheet Reader Modal */}
      {modalOpen && player.character_sheet_path && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col p-3 sm:p-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-amber-200">Hoja de {player.name}</span>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 rounded-xl overflow-hidden border border-violet-500/30 bg-[#090712]">
            {isPDF ? (
              <iframe src={player.character_sheet_path} title="Hoja PDF" className="w-full h-full" />
            ) : (
              <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
                <img src={player.character_sheet_path} alt="Hoja ampliada" className="max-w-full max-h-full object-contain" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface InventoryTabProps {
  player: Player
  onInventoryAction: (payload: Record<string, unknown>) => void
}

export const InventoryTab: React.FC<InventoryTabProps> = ({ player, onInventoryAction }) => {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [description, setDescription] = useState('')
  const [search, setSearch] = useState('')

  const items = player.inventory ?? []
  const filtered = items.filter((it) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)
  })

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const qty = Number.parseInt(quantity, 10)
    onInventoryAction({
      action: 'ADD',
      name: name.trim(),
      quantity: Number.isNaN(qty) ? 1 : Math.max(0, qty),
      description: description.trim(),
    })
    setName('')
    setQuantity('1')
    setDescription('')
  }

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
          <Backpack className="w-4 h-4 text-violet-400" />
          Resumen de Ítems e Inventario ({items.length})
        </h3>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar ítems..."
            className="pl-8 pr-3 py-1.5 rounded-lg bg-[#090712] border border-violet-500/25 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
      </div>

      {/* Add Item Form */}
      <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-[#090712]/70 p-3 rounded-xl border border-violet-500/20">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del objeto (ej. Poción de Curación)"
          className="sm:col-span-5 px-3 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-xs text-slate-100 placeholder-slate-500"
        />
        <input
          type="number"
          min={0}
          max={9999}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Cant."
          className="sm:col-span-2 px-3 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-xs text-amber-200 font-mono"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción / efecto rápido (opcional)"
          className="sm:col-span-3 px-3 py-2 rounded-lg bg-[#120d22] border border-violet-500/25 text-xs text-slate-100 placeholder-slate-500"
        />
        <button
          type="submit"
          className="sm:col-span-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center justify-center gap-1 transition"
        >
          <Plus className="w-3.5 h-3.5" /> Añadir
        </button>
      </form>

      {/* Inventory List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400 bg-[#090712]/50 rounded-xl border border-dashed border-violet-500/20">
            Tu mochila está vacía. Agrega pociones, oro, armas o llaves arriba.
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#090712]/75 border border-violet-500/20"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-100 truncate">{item.name}</div>
                {item.description && (
                  <div className="text-xs text-slate-400 truncate mt-0.5">{item.description}</div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onInventoryAction({ action: 'ADJUST', item_id: item.id, delta: -1 })}
                  className="w-7 h-7 rounded-lg bg-[#120d22] border border-violet-500/30 hover:border-amber-400 text-slate-200 font-bold"
                >
                  -
                </button>
                <span className="w-8 text-center text-sm font-extrabold font-mono text-amber-200">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onInventoryAction({ action: 'ADJUST', item_id: item.id, delta: 1 })}
                  className="w-7 h-7 rounded-lg bg-[#120d22] border border-violet-500/30 hover:border-amber-400 text-slate-200 font-bold"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => onInventoryAction({ action: 'DELETE', item_id: item.id })}
                  className="p-1.5 ml-1 rounded-lg text-slate-500 hover:text-rose-400 transition"
                  title="Eliminar objeto"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

interface NotesTabProps {
  playerID: string
}

export const NotesTab: React.FC<NotesTabProps> = ({ playerID }) => {
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const loadedRef = useRef(false)

  useEffect(() => {
    loadedRef.current = false
    fetch(`/api/v1/player/${encodeURIComponent(playerID)}/notes`)
      .then((r) => r.json())
      .then((d) => {
        setContent(d.content || '')
        loadedRef.current = true
      })
      .catch(() => {
        loadedRef.current = true
      })
  }, [playerID])

  // 500ms debounce autosave to SQLite (SDD-05)
  useEffect(() => {
    if (!loadedRef.current) return
    setStatus('saving')
    const handler = window.setTimeout(() => {
      fetch(`/api/v1/player/${encodeURIComponent(playerID)}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
        .then(() => setStatus('saved'))
        .catch(() => setStatus('idle'))
    }, 500)
    return () => window.clearTimeout(handler)
  }, [content, playerID])

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
          <NotebookPen className="w-4 h-4 text-violet-400" />
          Bloc de Notas de Campaña
        </h3>
        <span className="text-[11px] text-slate-400">
          {status === 'saving'
            ? 'Guardando...'
            : status === 'saved'
              ? '✓ Guardado automáticamente'
              : 'Autoguardado 500 ms'}
        </span>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={11}
        placeholder="Anota pistas, nombres de PNJ, puntos de golpe actuales, ranuras de conjuro..."
        className="w-full rounded-xl bg-[#090712] border border-violet-500/30 p-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 leading-relaxed"
      />
    </div>
  )
}
