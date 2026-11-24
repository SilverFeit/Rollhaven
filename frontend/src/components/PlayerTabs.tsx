import React, { useEffect, useRef, useState } from 'react'
import { Backpack, Dices, FileText, Heart, NotebookPen, Plus, Search, Shield, Sparkles, Trash2, Upload, X, ZoomIn } from 'lucide-react'
import { Player, QuickSheetStats } from '../types'
import { RACES, RaceSVG, TOKEN_COLORS, getRaceLabel } from './RaceIcons'
import { DND_CONDITIONS } from '../lib/srdCompendiumAndGenerators'

interface CharacterSheetAndRaceTabProps {
  player: Player
  onUpdateProfile: (patch: { name?: string; initiative?: number; race?: string; color?: string }) => void
  onUpdateTactical?: (patch: {
    conditions?: string[]
    aura_radius?: number
    aura_color?: string
    stats_json?: QuickSheetStats
  }) => void
  onQuickRoll?: (notation: string) => void
}

const ABILITY_KEYS: ('FUE' | 'DES' | 'CON' | 'INT' | 'SAB' | 'CAR')[] = ['FUE', 'DES', 'CON', 'INT', 'SAB', 'CAR']

export const CharacterSheetAndRaceTab: React.FC<CharacterSheetAndRaceTabProps> = ({
  player,
  onUpdateProfile,
  onUpdateTactical,
  onQuickRoll,
}) => {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [stats, setStats] = useState<QuickSheetStats>(() => ({
    hp_current: player.stats_json?.hp_current ?? 24,
    hp_max: player.stats_json?.hp_max ?? 24,
    hp_temp: player.stats_json?.hp_temp ?? 0,
    ac: player.stats_json?.ac ?? 15,
    speed: player.stats_json?.speed ?? 30,
    proficiency: player.stats_json?.proficiency ?? 2,
    abilities: player.stats_json?.abilities ?? { FUE: 14, DES: 14, CON: 12, INT: 10, SAB: 12, CAR: 10 },
    macros: player.stats_json?.macros ?? [
      { id: 'm1', label: '⚔️ Ataque Principal', formula: '1d20+5' },
      { id: 'm2', label: '🩸 Daño Arma', formula: '1d8+3' },
    ],
  }))
  const [macroLabel, setMacroLabel] = useState('')
  const [macroFormula, setMacroFormula] = useState('')

  useEffect(() => {
    if (player.stats_json && Object.keys(player.stats_json).length > 0) {
      setStats((prev) => ({
        ...prev,
        ...player.stats_json,
        abilities: { ...(prev.abilities ?? { FUE: 10, DES: 10, CON: 10, INT: 10, SAB: 10, CAR: 10 }), ...(player.stats_json?.abilities ?? {}) },
        macros: player.stats_json?.macros ?? prev.macros,
      }))
    }
  }, [player.stats_json])

  const commitStats = (next: QuickSheetStats) => {
    setStats(next)
    onUpdateTactical?.({ stats_json: next })
  }

  const toggleCondition = (cid: string) => {
    const cur = player.conditions ?? []
    const next = cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid]
    onUpdateTactical?.({ conditions: next })
  }

  const abilityMod = (score: number) => Math.floor((score - 10) / 2)

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
      {/* Fari / MapTool Interactive Quick Stat Sheet, Conditions, Aura & Macros */}
      <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-4 space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-400" />
            Ficha Rápida Interactiva &amp; Macros
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Aura en mapa:</span>
            <select
              value={player.aura_radius ?? 0}
              onChange={(e) => onUpdateTactical?.({ aura_radius: Number(e.target.value), aura_color: player.color_hex })}
              className="px-2 py-1 rounded-lg bg-[#090712] border border-violet-500/30 text-amber-200 font-mono"
            >
              {[0, 5, 10, 15, 20, 30, 60].map((ft) => (
                <option key={ft} value={ft}>
                  {ft === 0 ? 'Sin aura' : `${ft} pies`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-[#090712]/75 p-2.5 rounded-xl border border-emerald-500/25">
            <div className="text-[10px] text-slate-400 uppercase">HP Actual / Máx</div>
            <div className="flex items-center gap-1 mt-1">
              <input
                type="number"
                value={stats.hp_current ?? 24}
                onChange={(e) => commitStats({ ...stats, hp_current: Number(e.target.value) })}
                className="w-14 px-1.5 py-1 rounded bg-[#120d22] border border-violet-500/25 text-emerald-300 font-mono font-bold text-center"
              />
              <span className="text-slate-500">/</span>
              <input
                type="number"
                value={stats.hp_max ?? 24}
                onChange={(e) => commitStats({ ...stats, hp_max: Number(e.target.value) })}
                className="w-14 px-1.5 py-1 rounded bg-[#120d22] border border-violet-500/25 text-slate-200 font-mono text-center"
              />
            </div>
          </div>

          <div className="bg-[#090712]/75 p-2.5 rounded-xl border border-sky-500/25">
            <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
              <Shield className="w-3 h-3 text-sky-400" /> CA (Armadura)
            </div>
            <input
              type="number"
              value={stats.ac ?? 15}
              onChange={(e) => commitStats({ ...stats, ac: Number(e.target.value) })}
              className="mt-1 w-full px-2 py-1 rounded bg-[#120d22] border border-violet-500/25 text-sky-300 font-mono font-bold text-center"
            />
          </div>

          <div className="bg-[#090712]/75 p-2.5 rounded-xl border border-violet-500/25">
            <div className="text-[10px] text-slate-400 uppercase">Velocidad (pies)</div>
            <input
              type="number"
              value={stats.speed ?? 30}
              onChange={(e) => commitStats({ ...stats, speed: Number(e.target.value) })}
              className="mt-1 w-full px-2 py-1 rounded bg-[#120d22] border border-violet-500/25 text-amber-200 font-mono font-bold text-center"
            />
          </div>

          <div className="bg-[#090712]/75 p-2.5 rounded-xl border border-amber-500/25">
            <div className="text-[10px] text-slate-400 uppercase">Competencia</div>
            <input
              type="number"
              value={stats.proficiency ?? 2}
              onChange={(e) => commitStats({ ...stats, proficiency: Number(e.target.value) })}
              className="mt-1 w-full px-2 py-1 rounded bg-[#120d22] border border-violet-500/25 text-amber-300 font-mono font-bold text-center"
            />
          </div>
        </div>

        {/* 6 Ability Scores with 1-click roll */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {ABILITY_KEYS.map((ab) => {
            const score = stats.abilities?.[ab] ?? 10
            const mod = abilityMod(score)
            const modText = mod >= 0 ? `+${mod}` : `${mod}`
            return (
              <div key={ab} className="bg-[#090712]/75 p-2 rounded-xl border border-violet-500/20 text-center space-y-1">
                <div className="text-[10px] font-bold text-violet-300">{ab}</div>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={score}
                  onChange={(e) =>
                    commitStats({
                      ...stats,
                      abilities: { ...(stats.abilities ?? { FUE: 10, DES: 10, CON: 10, INT: 10, SAB: 10, CAR: 10 }), [ab]: Number(e.target.value) },
                    })
                  }
                  className="w-full py-0.5 rounded bg-[#120d22] border border-violet-500/25 text-amber-200 font-mono font-bold text-center"
                />
                {onQuickRoll && (
                  <button
                    type="button"
                    onClick={() => onQuickRoll(`1d20${modText}`)}
                    className="w-full py-1 rounded bg-violet-600/35 hover:bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center gap-1"
                  >
                    <Dices className="w-3 h-3" /> {modText}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Macros (1-click roll buttons) */}
        <div className="space-y-2 pt-1 border-t border-violet-500/15">
          <div className="font-bold text-slate-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Botones Rápidos / Macros de Personaje
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(stats.macros ?? []).map((mac) => (
              <div key={mac.id} className="inline-flex items-center rounded-lg bg-[#090712] border border-amber-400/35 overflow-hidden">
                <button
                  type="button"
                  onClick={() => onQuickRoll?.(mac.formula)}
                  className="px-2.5 py-1.5 text-amber-200 hover:bg-amber-500/15 font-semibold"
                >
                  {mac.label} <span className="font-mono text-violet-300 ml-1">({mac.formula})</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    commitStats({ ...stats, macros: (stats.macros ?? []).filter((m) => m.id !== mac.id) })
                  }
                  className="px-1.5 py-1.5 text-slate-500 hover:text-rose-400 border-l border-white/10"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <input
              type="text"
              value={macroLabel}
              onChange={(e) => setMacroLabel(e.target.value)}
              placeholder="Nombre (ej. Rayo)"
              className="flex-1 min-w-[120px] px-2.5 py-1.5 rounded-lg bg-[#090712] border border-violet-500/25 text-slate-100"
            />
            <input
              type="text"
              value={macroFormula}
              onChange={(e) => setMacroFormula(e.target.value)}
              placeholder="Fórmula (ej. 8d6 o 2d20kh1+5)"
              className="w-36 px-2.5 py-1.5 rounded-lg bg-[#090712] border border-violet-500/25 text-amber-200 font-mono"
            />
            <button
              type="button"
              onClick={() => {
                if (!macroLabel.trim() || !macroFormula.trim()) return
                commitStats({
                  ...stats,
                  macros: [
                    ...(stats.macros ?? []),
                    { id: `m_${Date.now()}`, label: macroLabel.trim(), formula: macroFormula.trim() },
                  ],
                })
                setMacroLabel('')
                setMacroFormula('')
              }}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white font-bold"
            >
              + Macro
            </button>
          </div>
        </div>

        {/* Active Conditions (15 D&D 5e status tags) */}
        <div className="space-y-1.5 pt-1 border-t border-violet-500/15">
          <div className="font-bold text-slate-300">Condiciones Activas (visibles en tu ficha del mapa):</div>
          <div className="flex flex-wrap gap-1.5">
            {DND_CONDITIONS.map((cond) => {
              const active = (player.conditions ?? []).includes(cond.id)
              return (
                <button
                  key={cond.id}
                  type="button"
                  title={cond.summary}
                  onClick={() => toggleCondition(cond.id)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    active ? 'text-slate-950 font-bold' : 'bg-[#090712] text-slate-400 border-violet-500/20 hover:text-slate-200'
                  }`}
                  style={active ? { backgroundColor: cond.color, borderColor: cond.color } : undefined}
                >
                  {cond.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

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
