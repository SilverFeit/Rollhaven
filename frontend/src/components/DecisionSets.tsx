import React, { useEffect, useRef, useState } from 'react'
import { Coins, Dices, Disc3, HelpCircle, LayoutGrid, Plus, RotateCw, Sparkles, Trash2 } from 'lucide-react'
import { CoinDetail, DiceDetail, Magic8Detail, RollBroadcast, WheelDetail } from '../types'
import { DicePhysicsArena } from './DicePhysicsArena'
import { PeonzaArenaCanvas } from './PeonzaArenaCanvas'
import { triggerGestureHaptic } from '../lib/haptics'

interface DecisionSetsProps {
  onRoll: (payload: Record<string, unknown>) => void
  disabled?: boolean
  lastBroadcast: RollBroadcast | null
  localPlayerID: string
  asDM?: boolean
}

type SetTab = 'DICE' | 'COIN' | 'MAGIC_8_BALL' | 'SPINNER' | 'WHEEL'

const STANDARD_DICE = [2, 4, 6, 8, 10, 12, 20, 100] as const

const DEFAULT_SPINNER_FACES = ['Pasa turno', 'Toma 1', 'Toma 2', 'Todos ponen', 'Pon 1', 'Pon 2']
const DEFAULT_WHEEL_OPTIONS = ['Atacar', 'Huir', 'Usar Poción', 'Esconderse', 'Negociar', 'Investigar']

const WHEEL_COLORS = [
  '#7c3aed', '#d97706', '#059669', '#2563eb', '#db2777', '#dc2626',
  '#0891b2', '#65a30d', '#9333ea', '#ea580c', '#0d9488', '#4f46e5',
]

function polarToCartesian(cx: number, cy: number, r: number, angleDegClockwiseFromTop: number) {
  const rad = ((angleDegClockwiseFromTop - 90) * Math.PI) / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  }
}

function describeSlice(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1'
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
}

export const DecisionSets: React.FC<DecisionSetsProps> = ({
  onRoll,
  disabled = false,
  lastBroadcast,
  localPlayerID,
  asDM = false,
}) => {
  const [activeTab, setActiveTab] = useState<SetTab>('DICE')
  const [showAllSets, setShowAllSets] = useState(false)

  // Set 1: Dice state + 1:1 physical arena hold-to-shake state
  const [diceCount, setDiceCount] = useState(2)
  const [diceMod, setDiceMod] = useState(0)
  const [selectedSides, setSelectedSides] = useState<number>(20)
  const [holdingDiceBtn, setHoldingDiceBtn] = useState(false)
  const [customNotation, setCustomNotation] = useState('2d20+0')
  const diceHoldTimerRef = useRef<number | null>(null)
  const activeHoldSidesRef = useRef<number | null>(null)

  // Set 2: Coin animation
  const [coinAnimating, setCoinAnimating] = useState(false)

  // Set 3: Magic 8 Ball state
  const [question, setQuestion] = useState('')
  const [strictYesNo, setStrictYesNo] = useState(false)
  const [ballShaking, setBallShaking] = useState(false)

  // Set 4: Peonza (4-12 faces)
  const [spinnerFaces, setSpinnerFaces] = useState<string[]>(DEFAULT_SPINNER_FACES)
  const [newSpinnerFace, setNewSpinnerFace] = useState('')

  // Set 5: Ruleta de Decisión (top-down view)
  const [wheelOptions, setWheelOptions] = useState<string[]>(DEFAULT_WHEEL_OPTIONS)
  const [newWheelOption, setNewWheelOption] = useState('')
  const [wheelRotation, setWheelRotation] = useState(0)
  const [wheelSpinning, setWheelSpinning] = useState(false)
  const [wheelRevealedOption, setWheelRevealedOption] = useState<string | null>(null)
  const lastWheelHandledID = useRef<number>(0)

  const targetOwnerID = asDM ? 'dm' : localPlayerID

  useEffect(() => {
    return () => {
      if (diceHoldTimerRef.current) {
        window.clearTimeout(diceHoldTimerRef.current)
      }
    }
  }, [])

  // Animate Wheel when server returns a WHEEL result
  useEffect(() => {
    if (!lastBroadcast || lastBroadcast.set_type !== 'WHEEL') return
    if (lastBroadcast.id === lastWheelHandledID.current) return
    lastWheelHandledID.current = lastBroadcast.id

    const detail = lastBroadcast.detail as WheelDetail
    if (!detail || typeof detail.winning_index !== 'number' || !detail.options?.length) return

    const n = detail.options.length
    const sliceAngle = 360 / n
    const centerAngle = (detail.winning_index + 0.5) * sliceAngle
    const targetMod = (360 - (centerAngle % 360)) % 360

    setWheelSpinning(true)
    setWheelRevealedOption(null)
    setWheelRotation((prev) => {
      const base = prev + 1800
      const delta = (targetMod - (base % 360) + 360) % 360
      return base + delta
    })

    const timer = window.setTimeout(() => {
      setWheelSpinning(false)
      setWheelRevealedOption(detail.option)
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [lastBroadcast])

  const triggerDice = (sides: number) => {
    setSelectedSides(sides)
    const modSuffix = diceMod > 0 ? `+${diceMod}` : diceMod < 0 ? `${diceMod}` : ''
    const notation = `${diceCount}d${sides}${modSuffix}`
    setCustomNotation(notation)
    onRoll({ type: 'DICE', dice_notation: notation, as_dm: asDM })
  }

  const handleDieBtnDown = (sides: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    triggerGestureHaptic('tap')
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelectedSides(sides)
    activeHoldSidesRef.current = sides
    if (diceHoldTimerRef.current) window.clearTimeout(diceHoldTimerRef.current)
    diceHoldTimerRef.current = window.setTimeout(() => {
      setHoldingDiceBtn(true)
    }, 150)
  }

  const handleDieBtnUp = (sides: number) => {
    if (diceHoldTimerRef.current) {
      window.clearTimeout(diceHoldTimerRef.current)
      diceHoldTimerRef.current = null
    }
    if (activeHoldSidesRef.current !== sides) return
    activeHoldSidesRef.current = null
    setHoldingDiceBtn(false)
    if (!disabled) {
      triggerGestureHaptic('throw')
      triggerDice(sides)
    }
  }

  const handleDieBtnCancel = () => {
    if (diceHoldTimerRef.current) {
      window.clearTimeout(diceHoldTimerRef.current)
      diceHoldTimerRef.current = null
    }
    activeHoldSidesRef.current = null
    setHoldingDiceBtn(false)
  }

  const triggerCustomDice = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customNotation.trim()) return
    onRoll({ type: 'DICE', dice_notation: customNotation.trim(), as_dm: asDM })
  }

  const triggerCoin = () => {
    triggerGestureHaptic('throw')
    setCoinAnimating(true)
    onRoll({ type: 'COIN', as_dm: asDM })
    window.setTimeout(() => setCoinAnimating(false), 1100)
  }

  const triggerMagic8 = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    triggerGestureHaptic('throw')
    setBallShaking(true)
    onRoll({
      type: 'MAGIC_8_BALL',
      strict_yes_no: strictYesNo,
      question: question.trim(),
      as_dm: asDM,
    })
    window.setTimeout(() => setBallShaking(false), 650)
  }

  const triggerSpinner = () => {
    void targetOwnerID
    triggerGestureHaptic('throw')
    onRoll({ type: 'SPINNER', faces: spinnerFaces, as_dm: asDM })
  }

  const triggerWheel = () => {
    triggerGestureHaptic('throw')
    onRoll({ type: 'WHEEL', options: wheelOptions, as_dm: asDM })
  }

  // Extract typed latest results per set for dedicated showcase cards
  const latestDice = lastBroadcast?.set_type === 'DICE' ? (lastBroadcast.detail as DiceDetail) : null
  const latestCoin = lastBroadcast?.set_type === 'COIN' ? (lastBroadcast.detail as CoinDetail) : null
  const latestMagic8 = lastBroadcast?.set_type === 'MAGIC_8_BALL' ? (lastBroadcast.detail as Magic8Detail) : null
  const activeWheelOptions = wheelOptions

  const tabs: { id: SetTab; label: string; icon: React.ReactNode }[] = [
    { id: 'DICE', label: 'Dados', icon: <Dices className="w-4 h-4" /> },
    { id: 'COIN', label: 'Moneda', icon: <Coins className="w-4 h-4" /> },
    { id: 'MAGIC_8_BALL', label: 'Magic 8', icon: <HelpCircle className="w-4 h-4" /> },
    { id: 'SPINNER', label: 'Peonza', icon: <RotateCw className="w-4 h-4" /> },
    { id: 'WHEEL', label: 'Ruleta', icon: <Disc3 className="w-4 h-4" /> },
  ]

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-3.5 sm:p-5 space-y-4">
      {/* Decision Set Selector Tabs + optional DM All-in-One Toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[260px] grid grid-cols-5 gap-1.5 bg-[#090712]/80 p-1.5 rounded-xl border border-violet-500/20">
          {tabs.map((t) => {
            const active = !showAllSets && activeTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setShowAllSets(false)
                  setActiveTab(t.id)
                }}
                className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition ${
                  active
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-900/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                {t.icon}
                <span className="truncate">{t.label}</span>
              </button>
            )
          })}
        </div>
        {asDM && (
          <button
            type="button"
            onClick={() => setShowAllSets((s) => !s)}
            className={`px-3 py-2.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition shrink-0 ${
              showAllSets
                ? 'bg-amber-500 text-slate-950 border-amber-400'
                : 'bg-[#090712]/80 text-violet-200 border-violet-500/30 hover:border-amber-400/50'
            }`}
            title="Mostrar o agrupar los 5 objetos de decisión"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {showAllSets ? 'Ver por Pestañas' : 'Ver los 5 Sets'}
          </button>
        )}
      </div>

      {/* SET 1: POLYHEDRAL DICE */}
      {(showAllSets || activeTab === 'DICE') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#090712]/60 p-3 rounded-xl border border-violet-500/20">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Cantidad:</span>
              <div className="flex items-center rounded-lg border border-violet-500/30 bg-[#120d22]">
                <button
                  type="button"
                  onClick={() => setDiceCount((c) => Math.max(1, c - 1))}
                  className="px-2.5 py-1 text-slate-300 hover:text-white"
                >
                  -
                </button>
                <span className="px-2.5 text-sm font-bold text-amber-200 font-mono">{diceCount}</span>
                <button
                  type="button"
                  onClick={() => setDiceCount((c) => Math.min(20, c + 1))}
                  className="px-2.5 py-1 text-slate-300 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Modificador:</span>
              <div className="flex items-center rounded-lg border border-violet-500/30 bg-[#120d22]">
                <button
                  type="button"
                  onClick={() => setDiceMod((m) => Math.max(-50, m - 1))}
                  className="px-2.5 py-1 text-slate-300 hover:text-white"
                >
                  -
                </button>
                <span className="px-2.5 text-sm font-bold text-violet-300 font-mono">
                  {diceMod >= 0 ? `+${diceMod}` : diceMod}
                </span>
                <button
                  type="button"
                  onClick={() => setDiceMod((m) => Math.min(50, m + 1))}
                  className="px-2.5 py-1 text-slate-300 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* 1:1 Physical Dice Arena with Wall & Die-to-Die Collisions, Hold-to-Shake & Phone Shake */}
          <DicePhysicsArena
            selectedSides={selectedSides}
            diceCount={diceCount}
            externalHolding={holdingDiceBtn}
            disabled={disabled}
            lastBroadcast={lastBroadcast}
            onRollCompleteRequest={(sides) => triggerDice(sides)}
          />

          <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
            {STANDARD_DICE.map((sides) => {
              const isSelected = selectedSides === sides
              return (
                <button
                  key={sides}
                  type="button"
                  disabled={disabled}
                  onPointerDown={(e) => handleDieBtnDown(sides, e)}
                  onPointerUp={() => handleDieBtnUp(sides)}
                  onPointerCancel={handleDieBtnCancel}
                  className={`group relative overflow-hidden rounded-xl border p-3 text-center transition active:scale-95 disabled:opacity-45 touch-none select-none ${
                    isSelected
                      ? 'border-amber-400/80 bg-gradient-to-b from-violet-900/60 to-[#140e29] shadow-md shadow-amber-950/40'
                      : 'border-violet-500/30 bg-gradient-to-b from-[#1a1233] to-[#0e0a1c] hover:border-amber-400/60'
                  }`}
                >
                  <div className="text-base sm:text-lg font-extrabold text-amber-200 group-hover:text-amber-300 font-mono">
                    d{sides}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {diceCount}d{sides}
                    {diceMod !== 0 ? (diceMod > 0 ? `+${diceMod}` : diceMod) : ''}
                  </div>
                </button>
              )
            })}
          </div>

          <form onSubmit={triggerCustomDice} className="flex gap-2">
            <input
              type="text"
              value={customNotation}
              onChange={(e) => setCustomNotation(e.target.value)}
              placeholder="Ej. 2d8+4 o 1d20-1"
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#090712] border border-violet-500/30 text-sm font-mono text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              type="submit"
              disabled={disabled}
              className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-sm font-bold transition"
            >
              Lanzar
            </button>
          </form>

          {latestDice && (
            <div
              className={`rounded-xl p-3 border text-xs flex flex-wrap items-center justify-between gap-2 ${
                latestDice.is_critical
                  ? 'border-emerald-400/70 bg-emerald-950/40 text-emerald-200'
                  : latestDice.is_fumble
                    ? 'border-rose-500/70 bg-rose-950/40 text-rose-200'
                    : 'border-violet-500/20 bg-[#090712]/70 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono font-bold text-amber-300">{latestDice.notation}:</span>
                {latestDice.rolls.map((val, idx) => (
                  <span
                    key={idx}
                    className={`px-2 py-0.5 rounded font-mono font-bold ${
                      latestDice.sides === 20 && val === 20
                        ? 'bg-emerald-500 text-slate-950'
                        : latestDice.sides === 20 && val === 1
                          ? 'bg-rose-600 text-white'
                          : 'bg-violet-900/60 text-violet-100'
                    }`}
                  >
                    {val}
                  </span>
                ))}
                {latestDice.modifier !== 0 && (
                  <span className="font-mono text-slate-400">
                    {latestDice.modifier > 0 ? `+ ${latestDice.modifier}` : `- ${Math.abs(latestDice.modifier)}`}
                  </span>
                )}
              </div>
              <div className="text-base font-black font-mono">Total: {latestDice.total}</div>
            </div>
          )}
        </div>
      )}

      {/* SET 2: REALISTIC PHYSICS COIN */}
      {(showAllSets || activeTab === 'COIN') && (
        <div className="flex flex-col items-center text-center py-3 space-y-4">
          <div
            className={`w-28 h-28 rounded-full flex items-center justify-center border-4 shadow-xl transition ${
              coinAnimating ? 'animate-coin-spin' : ''
            } ${
              latestCoin?.is_edge
                ? 'border-amber-300 bg-gradient-to-br from-amber-300 via-yellow-500 to-amber-700 text-slate-950 shadow-amber-400/50'
                : latestCoin?.raw_value === 'CRUZ'
                  ? 'border-violet-400 bg-gradient-to-br from-slate-700 to-slate-900 text-violet-200 shadow-violet-900/50'
                  : 'border-amber-400 bg-gradient-to-br from-amber-500/80 to-amber-800 text-amber-50 shadow-amber-900/40'
            }`}
          >
            <div className="font-black tracking-wider text-sm px-2">
              {coinAnimating ? '...' : latestCoin ? latestCoin.raw_value : 'MONEDA'}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-bold text-amber-200">
              {latestCoin ? latestCoin.display_label : 'Cara, Cruz o Canto (1 en 6000)'}
            </div>
            <div className="text-[11px] text-slate-400">
              Probabilidades reales: Cara 49.9917% · Cruz 49.9917% · Canto 0.0167% (1/6000)
            </div>
          </div>

          <button
            type="button"
            disabled={disabled}
            onClick={triggerCoin}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-extrabold text-sm shadow-lg shadow-amber-900/40 transition active:scale-95 disabled:opacity-45"
          >
            Lanzar Moneda
          </button>
        </div>
      )}

      {/* SET 3: MAGIC 8 BALL */}
      {(showAllSets || activeTab === 'MAGIC_8_BALL') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#090712]/70 p-3 rounded-xl border border-violet-500/20">
            <span className="text-xs text-slate-300 font-medium">Modo de Oráculo:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStrictYesNo(false)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  !strictYesNo ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                20 Respuestas Clásicas
              </button>
              <button
                type="button"
                onClick={() => setStrictYesNo(true)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  strictYesNo ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                }`}
              >
                Sí / No Estricto (50/50)
              </button>
            </div>
          </div>

          <form onSubmit={triggerMagic8} className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Pregunta opcional (ej. ¿El cofre tiene trampa?)"
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#090712] border border-violet-500/30 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              type="submit"
              disabled={disabled}
              className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition disabled:opacity-45"
            >
              Consultar
            </button>
          </form>

          <div className="flex justify-center py-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => triggerMagic8()}
              className={`relative w-48 h-48 rounded-full bg-[radial-gradient(circle_at_30%_30%,_#3b2b63,_#090712_72%)] border-2 border-violet-400/35 shadow-2xl shadow-violet-950 flex items-center justify-center p-6 cursor-pointer hover:border-amber-400/60 transition ${
                ballShaking ? 'animate-ball-shake' : ''
              }`}
            >
              <div className="w-28 h-28 rounded-full bg-[#05030a] border border-indigo-400/40 flex items-center justify-center p-2 shadow-inner">
                <div className="w-24 h-24 rounded-full bg-gradient-to-b from-indigo-900/70 to-violet-950/90 flex items-center justify-center p-2 text-center">
                  {latestMagic8 ? (
                    <span
                      className={`text-xs font-extrabold leading-tight ${
                        latestMagic8.category === 'AFFIRMATIVE'
                          ? 'text-emerald-300'
                          : latestMagic8.category === 'NEGATIVE'
                            ? 'text-rose-300'
                            : 'text-amber-200'
                      }`}
                    >
                      {latestMagic8.answer}
                    </span>
                  ) : (
                    <span className="text-3xl font-black text-violet-300/80">8</span>
                  )}
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* SET 4: PEONZA 3D EN PERSPECTIVA CON REBOTES (4-12 CARAS) */}
      {(showAllSets || activeTab === 'SPINNER') && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <PeonzaArenaCanvas
            faces={spinnerFaces}
            lastBroadcast={lastBroadcast}
            disabled={disabled}
            onSpin={triggerSpinner}
          />

          {/* Faces Editor (4 to 12 faces) */}
          <div className="bg-[#090712]/70 rounded-xl p-3 border border-violet-500/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-violet-300">
                Caras ({spinnerFaces.length}/12, mín. 4)
              </span>
              <button
                type="button"
                onClick={() => setSpinnerFaces(DEFAULT_SPINNER_FACES)}
                className="text-[11px] text-amber-300 hover:underline"
              >
                Restaurar 6 de fábrica
              </button>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {spinnerFaces.map((face, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={face}
                    maxLength={24}
                    onChange={(e) => {
                      const next = [...spinnerFaces]
                      next[idx] = e.target.value
                      setSpinnerFaces(next)
                    }}
                    className="flex-1 px-2.5 py-1 rounded-lg bg-[#120d22] border border-violet-500/25 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={spinnerFaces.length <= 4}
                    onClick={() => setSpinnerFaces(spinnerFaces.filter((_, i) => i !== idx))}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 disabled:opacity-30"
                    title="Eliminar cara"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {spinnerFaces.length < 12 && (
              <div className="flex gap-1.5 pt-1">
                <input
                  type="text"
                  value={newSpinnerFace}
                  onChange={(e) => setNewSpinnerFace(e.target.value)}
                  placeholder="Nueva cara..."
                  maxLength={24}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#120d22] border border-violet-500/30 text-xs text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newSpinnerFace.trim()) return
                    setSpinnerFaces([...spinnerFaces, newSpinnerFace.trim()])
                    setNewSpinnerFace('')
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Añadir
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SET 5: RULETA DE DECISIÓN */}
      {(showAllSets || activeTab === 'WHEEL') && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <div className="flex flex-col items-center space-y-3">
            <div className="relative w-56 h-56 flex items-center justify-center">
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-10 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[16px] border-l-transparent border-r-transparent border-t-amber-300 drop-shadow" />
              <svg
                viewBox="0 0 220 220"
                className="w-52 h-52 drop-shadow-2xl"
                style={{
                  transform: `rotate(${wheelRotation}deg)`,
                  transition: 'transform 2.5s cubic-bezier(0.12, 0.86, 0.22, 1)',
                }}
              >
                {activeWheelOptions.map((opt, i) => {
                  const n = activeWheelOptions.length
                  const angle = 360 / n
                  const start = i * angle
                  const end = (i + 1) * angle
                  const mid = start + angle / 2
                  const labelPt = polarToCartesian(110, 110, 66, mid)
                  return (
                    <g key={i}>
                      <path
                        d={describeSlice(110, 110, 102, start, end)}
                        fill={WHEEL_COLORS[i % WHEEL_COLORS.length]}
                        stroke="#090712"
                        strokeWidth="2"
                      />
                      <text
                        x={labelPt.x}
                        y={labelPt.y}
                        fill="#ffffff"
                        fontSize={n > 10 ? '8' : '10'}
                        fontWeight="bold"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${mid}, ${labelPt.x}, ${labelPt.y})`}
                      >
                        {opt.length > 13 ? `${opt.slice(0, 12)}…` : opt}
                      </text>
                    </g>
                  )
                })}
                <circle cx="110" cy="110" r="14" fill="#090712" stroke="#fde68a" strokeWidth="3" />
              </svg>
            </div>

            <button
              type="button"
              disabled={disabled || wheelSpinning || wheelOptions.length < 2}
              onClick={triggerWheel}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-white font-bold text-sm shadow-lg transition disabled:opacity-45"
            >
              {wheelSpinning ? 'Girando Ruleta...' : `Girar Ruleta (${wheelOptions.length} opciones)`}
            </button>

            {wheelRevealedOption && (
              <div className="text-sm font-extrabold text-amber-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Decisión: {wheelRevealedOption}
              </div>
            )}
          </div>

          <div className="bg-[#090712]/70 rounded-xl p-3 border border-violet-500/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-violet-300">
                Opciones ({wheelOptions.length})
              </span>
              <button
                type="button"
                onClick={() => setWheelOptions(DEFAULT_WHEEL_OPTIONS)}
                className="text-[11px] text-amber-300 hover:underline"
              >
                Preset D&D
              </button>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {wheelOptions.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: WHEEL_COLORS[idx % WHEEL_COLORS.length] }}
                  />
                  <input
                    type="text"
                    value={opt}
                    maxLength={28}
                    onChange={(e) => {
                      const next = [...wheelOptions]
                      next[idx] = e.target.value
                      setWheelOptions(next)
                    }}
                    className="flex-1 px-2.5 py-1 rounded-lg bg-[#120d22] border border-violet-500/25 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={wheelOptions.length <= 2}
                    onClick={() => setWheelOptions(wheelOptions.filter((_, i) => i !== idx))}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {wheelOptions.length < 24 && (
              <div className="flex gap-1.5 pt-1">
                <input
                  type="text"
                  value={newWheelOption}
                  onChange={(e) => setNewWheelOption(e.target.value)}
                  placeholder="Agregar opción..."
                  maxLength={28}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#120d22] border border-violet-500/30 text-xs text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newWheelOption.trim()) return
                    setWheelOptions([...wheelOptions, newWheelOption.trim()])
                    setNewWheelOption('')
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Añadir
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
