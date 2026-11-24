import React, { useEffect, useState } from 'react'
import { ArrowRightCircle, Dices, FileText, Flame, MessageSquare, Shield, Swords, Zap } from 'lucide-react'
import { CharacterRecord, InteractiveRollAction, Player, RollSource } from '../types'
import {
  HotbarSlot,
  buildDefaultHotbarSlots,
  buildSpellRollPayload,
  formatSigned,
  getInitiativeBonus,
  getSavingThrowMod,
  getSkillMod,
  getWeaponAttackFormula,
  getWeaponDamageFormula,
  normalizeSheetFromRecord,
} from '../lib/characterRules'

interface PlayerQuickHotbarProps {
  variant?: 'bar' | 'radial'
  player: Player
  character?: CharacterRecord
  isMyTurn: boolean
  disabled?: boolean
  sheetOpen: boolean
  trackerOpen: boolean
  decisionsOpen: boolean
  onRollAction: (payload: {
    type: string
    dice_notation?: string
    visibility?: string
    source?: RollSource
    interactive_actions?: InteractiveRollAction[]
    update_initiative?: boolean
  }) => void
  onEndTurn: () => void
  onToggleSheet: () => void
  onToggleTracker: () => void
  onToggleDecisions: () => void
}

interface RadialActionItem {
  id: string
  label: string
  shortLabel: string
  icon: React.ReactNode
  colorClass: string
  onClick: () => void
}

export const PlayerQuickHotbar: React.FC<PlayerQuickHotbarProps> = ({
  variant = 'radial',
  player,
  character,
  isMyTurn,
  disabled = false,
  sheetOpen,
  trackerOpen,
  decisionsOpen,
  onRollAction,
  onEndTurn,
  onToggleSheet,
  onToggleTracker,
  onToggleDecisions,
}) => {
  const [radialOpen, setRadialOpen] = useState(false)

  const sheet = normalizeSheetFromRecord(
    character?.sheet_json || player.stats_json,
    character?.name || player.name
  )
  const slots = buildDefaultHotbarSlots(sheet)

  const executeSlot = (slot: HotbarSlot) => {
    if (disabled) return
    switch (slot.kind) {
      case 'initiative': {
        const mod = getInitiativeBonus(sheet)
        onRollAction({
          type: 'DICE',
          dice_notation: `1d20${formatSigned(mod)}`,
          update_initiative: true,
          source: { kind: 'initiative', name: 'Iniciativa', subtitle: `1d20${formatSigned(mod)}` },
        })
        return
      }
      case 'weapon_attack': {
        const weapon =
          sheet.weapons.find((w) => w.id === slot.ref_id) ||
          sheet.weapons.find((w) => w.equipped) ||
          sheet.weapons[0]
        if (!weapon) {
          onRollAction({
            type: 'DICE',
            dice_notation: '1d20+2',
            source: { kind: 'weapon', name: 'Ataque Desarmado', subtitle: '1d20+2' },
          })
          return
        }
        const atk = getWeaponAttackFormula(sheet, weapon)
        const dmg = getWeaponDamageFormula(sheet, weapon)
        onRollAction({
          type: 'DICE',
          dice_notation: atk.formula,
          source: { kind: 'weapon', name: weapon.name, subtitle: `Ataque (${atk.formula})` },
          interactive_actions: [
            {
              id: `hb_dmg_${weapon.id}`,
              kind: 'DAMAGE',
              label: `Rolear daño (${dmg} ${weapon.damage_type})`,
              formula: dmg,
              damage_type: weapon.damage_type,
            },
          ],
        })
        return
      }
      case 'weapon_damage': {
        const weapon =
          sheet.weapons.find((w) => w.id === slot.ref_id) ||
          sheet.weapons.find((w) => w.equipped) ||
          sheet.weapons[0]
        if (!weapon) return
        const dmg = getWeaponDamageFormula(sheet, weapon)
        onRollAction({
          type: 'DICE',
          dice_notation: dmg,
          source: { kind: 'weapon', name: `Daño: ${weapon.name}`, subtitle: weapon.damage_type },
        })
        return
      }
      case 'spell': {
        const sp = sheet.spells.find((s) => s.id === slot.ref_id)
        if (!sp) return
        onRollAction(buildSpellRollPayload(sheet, sp))
        return
      }
      case 'skill': {
        const skillId = slot.ref_id || 'percepcion'
        const mod = getSkillMod(sheet, skillId)
        onRollAction({
          type: 'DICE',
          dice_notation: `1d20${formatSigned(mod)}`,
          source: { kind: 'skill', name: slot.label, subtitle: `1d20${formatSigned(mod)}` },
        })
        return
      }
      case 'save': {
        const ab = (slot.ref_id || 'DES') as 'FUE' | 'DES' | 'CON' | 'INT' | 'SAB' | 'CAR'
        const mod = getSavingThrowMod(sheet, ab)
        onRollAction({
          type: 'DICE',
          dice_notation: `1d20${formatSigned(mod)}`,
          source: { kind: 'save', name: `Salvación ${ab}`, subtitle: `1d20${formatSigned(mod)}` },
        })
        return
      }
      case 'custom': {
        if (!slot.formula) return
        onRollAction({
          type: 'DICE',
          dice_notation: slot.formula,
          source: { kind: 'feature', name: slot.label, subtitle: slot.formula },
        })
      }
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const idx = Number.parseInt(e.key, 10)
      if (!Number.isNaN(idx) && idx >= 1 && idx <= slots.length) {
        e.preventDefault()
        executeSlot(slots[idx - 1])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [slots, disabled])

  const slotIcon = (kind: HotbarSlot['kind'], sizeClass = 'w-4 h-4') => {
    switch (kind) {
      case 'initiative':
        return <Zap className={`${sizeClass} text-amber-300`} />
      case 'weapon_attack':
      case 'weapon_damage':
        return <Swords className={`${sizeClass} text-rose-300`} />
      case 'spell':
        return <Flame className={`${sizeClass} text-orange-300`} />
      case 'save':
        return <Shield className={`${sizeClass} text-sky-300`} />
      default:
        return <Dices className={`${sizeClass} text-violet-300`} />
    }
  }

  if (variant === 'bar') {
    return (
      <div className="pointer-events-auto flex items-center gap-2 max-w-[calc(100vw-2rem)] rounded-2xl border border-violet-500/40 bg-[#090712]/90 backdrop-blur-xl px-2.5 py-1.5 shadow-2xl shadow-black/80">
        {/* Numbered Quick Action Slots */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
          {slots.map((slot, index) => (
            <button
              key={slot.id}
              type="button"
              disabled={disabled}
              onClick={() => executeSlot(slot)}
              title={`Tecla ${index + 1}: ${slot.label}`}
              className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold shrink-0 transition disabled:opacity-40 ${
                slot.kind === 'initiative'
                  ? 'bg-amber-500/15 hover:bg-amber-500/30 border-amber-400/45 text-amber-200'
                  : slot.kind === 'weapon_attack'
                    ? 'bg-rose-500/15 hover:bg-rose-500/30 border-rose-400/45 text-rose-100'
                    : 'bg-[#120d22] hover:bg-violet-600/35 border-violet-500/30 text-slate-100'
              }`}
            >
              <span className="text-[10px] font-mono px-1 rounded bg-black/50 text-slate-400 group-hover:text-white">
                {index + 1}
              </span>
              {slotIcon(slot.kind, 'w-3.5 h-3.5')}
              <span className="max-w-[130px] truncate">{slot.label}</span>
            </button>
          ))}
        </div>

        {/* Utility Toggles & End Turn */}
        <div className="flex items-center gap-1.5 pl-2 border-l border-violet-500/25 shrink-0">
          <button
            type="button"
            onClick={onToggleSheet}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition ${
              sheetOpen
                ? 'bg-amber-500 text-slate-950 border-amber-300'
                : 'bg-[#120d22] text-amber-200 border-amber-500/30 hover:bg-amber-500/15'
            }`}
            title="Abrir Mi Hoja"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Hoja</span>
          </button>

          <button
            type="button"
            onClick={onToggleDecisions}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition ${
              decisionsOpen
                ? 'bg-violet-600 text-white border-violet-400'
                : 'bg-[#120d22] text-slate-200 border-violet-500/30 hover:bg-violet-600/25'
            }`}
            title="Abrir 5 Sets de Decisión"
          >
            <Dices className="w-3.5 h-3.5" />
            <span>5 Sets</span>
          </button>

          <button
            type="button"
            onClick={onToggleTracker}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition ${
              trackerOpen
                ? 'bg-violet-600 text-white border-violet-400'
                : 'bg-[#120d22] text-slate-200 border-violet-500/30 hover:bg-violet-600/25'
            }`}
            title="Mostrar/ocultar Tracker de Tiradas & Chat"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
          </button>

          {isMyTurn && (
            <button
              type="button"
              onClick={onEndTurn}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 text-xs font-extrabold flex items-center gap-1 shadow-lg shadow-amber-900/40"
            >
              <ArrowRightCircle className="w-3.5 h-3.5" />
              <span>Pasar Turno</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  const radialItems: RadialActionItem[] = [
    ...slots.slice(0, 5).map((slot, i) => ({
      id: slot.id,
      label: `${i + 1}. ${slot.label}`,
      shortLabel: slot.label.replace(/^Atacar:\s*/i, 'Atq: ').replace(/^Daño:\s*/i, 'Dmg: '),
      icon: slotIcon(slot.kind),
      colorClass:
        slot.kind === 'initiative'
          ? 'border-amber-400/70 bg-amber-950/90 text-amber-100'
          : slot.kind === 'weapon_attack'
            ? 'border-rose-400/70 bg-rose-950/90 text-rose-100'
            : 'border-violet-400/60 bg-[#120d22]/95 text-slate-100',
      onClick: () => {
        executeSlot(slot)
        setRadialOpen(false)
      },
    })),
    {
      id: 'util_sheet',
      label: 'Mi Hoja',
      shortLabel: 'Mi Hoja',
      icon: <FileText className="w-4 h-4 text-amber-300" />,
      colorClass: sheetOpen
        ? 'border-amber-300 bg-amber-500 text-slate-950'
        : 'border-amber-400/60 bg-[#120d22]/95 text-amber-200',
      onClick: () => {
        onToggleSheet()
        setRadialOpen(false)
      },
    },
    {
      id: 'util_sets',
      label: '5 Sets Dados',
      shortLabel: '5 Sets',
      icon: <Dices className="w-4 h-4 text-violet-300" />,
      colorClass: decisionsOpen
        ? 'border-violet-300 bg-violet-600 text-white'
        : 'border-violet-400/60 bg-[#120d22]/95 text-violet-200',
      onClick: () => {
        onToggleDecisions()
        setRadialOpen(false)
      },
    },
    {
      id: 'util_tracker',
      label: 'Tracker / Chat',
      shortLabel: 'Chat',
      icon: <MessageSquare className="w-4 h-4 text-sky-300" />,
      colorClass: trackerOpen
        ? 'border-sky-300 bg-sky-600 text-white'
        : 'border-sky-400/60 bg-[#120d22]/95 text-sky-200',
      onClick: () => {
        onToggleTracker()
        setRadialOpen(false)
      },
    },
  ]

  // Fan out from bottom-right trigger upward and to the left (angles 95deg .. 178deg in math screen coords where -Y is up)
  const total = radialItems.length
  const innerCount = Math.min(4, total)

  return (
    <div className="pointer-events-auto relative flex items-center gap-2">
      {/* Backdrop click to close radial menu */}
      {radialOpen && (
        <div
          className="fixed inset-0 z-[-1]"
          onClick={() => setRadialOpen(false)}
        />
      )}

      {/* Radial Petal Buttons expanding from the center of the Quick Actions button */}
      {radialOpen &&
        radialItems.map((item, idx) => {
          const isOuter = idx >= innerCount
          const ringIdx = isOuter ? idx - innerCount : idx
          const ringTotal = isOuter ? total - innerCount : innerCount
          const radius = isOuter ? 156 : 92
          // Up-and-left quadrant: from straight-up (-90deg) to left (-175deg)
          const startDeg = -94
          const endDeg = -174
          const deg =
            ringTotal <= 1
              ? (startDeg + endDeg) / 2
              : startDeg + ((endDeg - startDeg) * ringIdx) / (ringTotal - 1)
          const rad = (deg * Math.PI) / 180
          const tx = Math.cos(rad) * radius
          const ty = Math.sin(rad) * radius

          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled && item.id.startsWith('slot_')}
              onClick={item.onClick}
              style={{
                transform: `translate(${tx}px, ${ty}px)`,
              }}
              title={item.label}
              className={`absolute bottom-1 right-1 z-30 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center w-14 h-14 rounded-full border-2 shadow-xl shadow-black/80 backdrop-blur-md transition-transform hover:scale-110 active:scale-95 ${item.colorClass}`}
            >
              {item.icon}
              <span className="mt-0.5 max-w-[48px] truncate text-[9px] font-extrabold leading-none px-0.5">
                {item.shortLabel}
              </span>
            </button>
          )
        })}

      {isMyTurn && (
        <button
          type="button"
          onClick={onEndTurn}
          className="px-3 py-2.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 text-xs font-extrabold flex items-center gap-1 shadow-xl shadow-amber-950/70 border border-amber-200"
        >
          <ArrowRightCircle className="w-4 h-4" />
          <span className="hidden sm:inline">Pasar Turno</span>
        </button>
      )}

      {/* Center Radial Hub Button */}
      <button
        type="button"
        onClick={() => setRadialOpen((v) => !v)}
        className={`h-12 px-4 rounded-full border-2 font-extrabold text-xs flex items-center gap-2 shadow-2xl shadow-black/80 transition-all ${
          radialOpen
            ? 'bg-amber-400 text-slate-950 border-white scale-105'
            : 'bg-gradient-to-r from-violet-600 to-amber-500 text-white border-amber-300/70 hover:scale-105'
        }`}
      >
        <Zap className="w-4 h-4 shrink-0" />
        <span>Accesos</span>
      </button>
    </div>
  )
}
