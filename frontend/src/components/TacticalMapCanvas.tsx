import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudFog,
  Eraser,
  Flame,
  Hand,
  MapPin,
  Maximize2,
  Pencil,
  Radio,
  Ruler,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { MapEntity, Player, SessionConfig, TemporaryMapEvent } from '../types'
import { DND_CONDITIONS } from '../lib/srdCompendiumAndGenerators'

export interface DMSelection {
  kind: 'player' | 'entity'
  id: string
}

export type CanvasTool = 'move' | 'place' | 'ruler' | 'ping' | 'aoe' | 'draw' | 'fog_reveal' | 'fog_hide'

interface TacticalMapCanvasProps {
  session: SessionConfig
  players: Player[]
  entities?: MapEntity[]
  tempEvents?: TemporaryMapEvent[]
  localPlayerID: string
  activePlayerID: string
  activeCombatantID?: string
  localPlayerName?: string
  localColor?: string
  isDM?: boolean
  dmMode?: 'move' | 'place'
  selectedDMTarget?: DMSelection | null
  fullViewport?: boolean
  focusTarget?: { x: number; y: number; tick: number } | null
  onMoveToken: (playerID: string, x: number, y: number) => void
  onCellClick?: (x: number, y: number) => void
  onEntityClick?: (entity: MapEntity) => void
  onTempEvent?: (ev: TemporaryMapEvent) => void
  onUpdateFog?: (enabled: boolean, revealed: string[]) => void
}

// Each tactical cell is strictly 1:1 square in logical canvas units;
// the outer board adapts its aspect ratio to (cols * CELL_SIZE) x (rows * CELL_SIZE).
const LOGICAL_CELL_SIZE = 50

export const TacticalMapCanvas: React.FC<TacticalMapCanvasProps> = ({
  session,
  players,
  entities = [],
  tempEvents = [],
  localPlayerID,
  activePlayerID,
  activeCombatantID,
  localPlayerName = 'Mesa',
  localColor = '#fbbf24',
  isDM = false,
  dmMode = 'move',
  selectedDMTarget = null,
  fullViewport = false,
  focusTarget = null,
  onMoveToken,
  onCellClick,
  onEntityClick,
  onTempEvent,
  onUpdateFog,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bgImgRef = useRef<HTMLImageElement | null>(null)
  const avatarCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const [imgLoadedTick, setImgLoadedTick] = useState(0)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null)

  const [tool, setTool] = useState<CanvasTool>(isDM && dmMode === 'place' ? 'place' : 'move')
  const [aoeShape, setAoeShape] = useState<'sphere' | 'cone' | 'cube' | 'line'>('sphere')
  const [aoeRadiusFt, setAoeRadiusFt] = useState<number>(20)

  // Local transient ruler / draw state while dragging before emitting or during drag
  const [rulerStart, setRulerStart] = useState<{ x: number; y: number } | null>(null)
  const [rulerEnd, setRulerEnd] = useState<{ x: number; y: number } | null>(null)
  const [drawStroke, setDrawStroke] = useState<{ x: number; y: number }[]>([])

  // Keep external dmMode in sync when DM switches between Move/Place in parent UI
  useEffect(() => {
    if (!isDM) return
    if (dmMode === 'place') {
      setTool('place')
    } else if (tool === 'place') {
      setTool('move')
    }
  }, [dmMode, isDM])

  const dragRef = useRef<{
    active: boolean
    startX: number
    startY: number
    origPanX: number
    origPanY: number
    moved: boolean
    fogChanged: Set<string>
  }>({ active: false, startX: 0, startY: 0, origPanX: 0, origPanY: 0, moved: false, fogChanged: new Set() })

  const cols = Math.max(5, Math.min(50, session.map_cols || 10))
  const rows = Math.max(5, Math.min(50, session.map_rows || 10))
  const boardWidth = cols * LOGICAL_CELL_SIZE
  const boardHeight = rows * LOGICAL_CELL_SIZE
  const fogEnabled = Boolean(session.fog_enabled)
  const fogRevealedSet = new Set(session.fog_revealed ?? [])

  // Load background map image when map_image_path changes
  useEffect(() => {
    if (!session.map_image_path) {
      bgImgRef.current = null
      setImgLoadedTick((t) => t + 1)
      return
    }
    const img = new Image()
    img.onload = () => {
      bgImgRef.current = img
      setImgLoadedTick((t) => t + 1)
    }
    img.src = session.map_image_path
  }, [session.map_image_path])

  const fitToContainer = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const pad = 24
    const scaleX = (rect.width - pad) / boardWidth
    const scaleY = (rect.height - pad) / boardHeight
    const initialZoom = Math.max(0.18, Math.min(2.2, Math.min(scaleX, scaleY)))
    setZoom(initialZoom)
    setPan({
      x: (rect.width - boardWidth * initialZoom) / 2,
      y: (rect.height - boardHeight * initialZoom) / 2,
    })
  }, [boardWidth, boardHeight])

  useEffect(() => {
    fitToContainer()
    const onResize = () => fitToContainer()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitToContainer])

  // Center camera on focusTarget when user clicks a portrait in the initiative tracker
  useEffect(() => {
    if (!focusTarget || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const targetZoom = Math.max(zoom, 1.05)
    const cx = (focusTarget.x + 0.5) * LOGICAL_CELL_SIZE
    const cy = (focusTarget.y + 0.5) * LOGICAL_CELL_SIZE
    setZoom(targetZoom)
    setPan({
      x: rect.width / 2 - cx * targetZoom,
      y: rect.height / 2 - cy * targetZoom,
    })
  }, [focusTarget?.tick])

  const getCachedAvatar = (url?: string): HTMLImageElement | null => {
    if (!url) return null
    const existing = avatarCacheRef.current.get(url)
    if (existing) {
      return existing.complete && existing.naturalWidth > 0 ? existing : null
    }
    const img = new Image()
    img.onload = () => setImgLoadedTick((t) => t + 1)
    img.src = url
    avatarCacheRef.current.set(url, img)
    return null
  }

  // High-performance requestAnimationFrame Canvas render loop
  useEffect(() => {
    let rafId = 0
    const render = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        const dpr = window.devicePixelRatio || 1
        const w = container.clientWidth
        const h = container.clientHeight
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr)
          canvas.height = Math.floor(h * dpr)
        }
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.fillStyle = '#07050f'
          ctx.fillRect(0, 0, w, h)

          ctx.save()
          ctx.translate(pan.x, pan.y)
          ctx.scale(zoom, zoom)

          const cellSize = LOGICAL_CELL_SIZE

          // Outer rectangular board sized strictly by (cols * cellSize) x (rows * cellSize)
          ctx.fillStyle = '#120d22'
          ctx.fillRect(0, 0, boardWidth, boardHeight)

          if (bgImgRef.current) {
            ctx.drawImage(bgImgRef.current, 0, 0, boardWidth, boardHeight)
          }

          // Hover cell highlight
          if (hoverCell && hoverCell.x >= 0 && hoverCell.x < cols && hoverCell.y >= 0 && hoverCell.y < rows) {
            ctx.fillStyle =
              tool === 'place'
                ? 'rgba(16, 185, 129, 0.28)'
                : tool === 'fog_reveal' || tool === 'fog_hide'
                  ? 'rgba(56, 189, 248, 0.28)'
                  : 'rgba(251, 191, 36, 0.22)'
            ctx.fillRect(hoverCell.x * cellSize, hoverCell.y * cellSize, cellSize, cellSize)
          }

          // Batched square grid lines
          ctx.beginPath()
          ctx.strokeStyle = session.map_grid_color || '#ffffff'
          ctx.globalAlpha = session.map_grid_opacity ?? 0.35
          ctx.lineWidth = Math.max(0.75, 1.2 / zoom)
          for (let c = 0; c <= cols; c++) {
            const x = c * cellSize
            ctx.moveTo(x, 0)
            ctx.lineTo(x, boardHeight)
          }
          for (let r = 0; r <= rows; r++) {
            const y = r * cellSize
            ctx.moveTo(0, y)
            ctx.lineTo(boardWidth, y)
          }
          ctx.stroke()
          ctx.globalAlpha = 1

          // Outer rectangular border
          ctx.strokeStyle = '#7c3aed'
          ctx.lineWidth = 3 / zoom
          ctx.strokeRect(0, 0, boardWidth, boardHeight)

          // Layer: Token & Entity Auras (PlanarAlly pattern)
          for (const ent of entities) {
            if ((ent.is_hidden && !isDM) || !ent.aura_radius || ent.aura_radius <= 0) continue
            const sz = Math.max(1, Math.min(4, ent.size || 1))
            const ecx = (ent.x + sz / 2) * cellSize
            const ecy = (ent.y + sz / 2) * cellSize
            const auraPx = ((ent.aura_radius / 5) + sz * 0.5) * cellSize
            ctx.beginPath()
            ctx.arc(ecx, ecy, auraPx, 0, Math.PI * 2)
            ctx.fillStyle = `${ent.aura_color || ent.color_hex || '#ef4444'}22`
            ctx.fill()
            ctx.strokeStyle = `${ent.aura_color || ent.color_hex || '#ef4444'}88`
            ctx.lineWidth = 1.5
            ctx.setLineDash([5, 4])
            ctx.stroke()
            ctx.setLineDash([])
          }

          for (const p of players) {
            if ((p.token_hidden && !isDM) || !p.aura_radius || p.aura_radius <= 0) continue
            const cx = (p.token_x + 0.5) * cellSize
            const cy = (p.token_y + 0.5) * cellSize
            const auraPx = (p.aura_radius / 5 + 0.5) * cellSize
            ctx.beginPath()
            ctx.arc(cx, cy, auraPx, 0, Math.PI * 2)
            ctx.fillStyle = `${p.aura_color || p.color_hex || '#a855f7'}26`
            ctx.fill()
            ctx.strokeStyle = `${p.aura_color || p.color_hex || '#a855f7'}aa`
            ctx.lineWidth = 1.5
            ctx.setLineDash([5, 4])
            ctx.stroke()
            ctx.setLineDash([])
          }

          // Render DM-placed Map Entities
          const sortedEntities = [...entities].sort((a, b) => {
            const rank = (k: string) => (k === 'hazard' || k === 'door' ? 0 : 1)
            return rank(a.kind) - rank(b.kind)
          })
          for (const ent of sortedEntities) {
            if (ent.is_hidden && !isDM) continue
            const sz = Math.max(1, Math.min(4, ent.size || 1))
            const ex = ent.x * cellSize
            const ey = ent.y * cellSize
            const ew = sz * cellSize
            const eh = sz * cellSize
            const ecx = ex + ew / 2
            const ecy = ey + eh / 2
            const isSelectedEnt = isDM && selectedDMTarget?.kind === 'entity' && selectedDMTarget.id === ent.id

            ctx.save()
            if (ent.is_hidden) ctx.globalAlpha = 0.5

            if (ent.kind === 'hazard') {
              ctx.fillStyle = `${ent.color_hex || '#f97316'}44`
              ctx.fillRect(ex + 2, ey + 2, ew - 4, eh - 4)
              ctx.strokeStyle = ent.color_hex || '#f97316'
              ctx.lineWidth = 2
              ctx.setLineDash([6, 4])
              ctx.strokeRect(ex + 2, ey + 2, ew - 4, eh - 4)
              ctx.setLineDash([])
            } else if (ent.kind === 'trap') {
              const r = Math.min(ew, eh) * 0.36
              ctx.beginPath()
              ctx.moveTo(ecx, ecy - r)
              ctx.lineTo(ecx + r, ecy + r * 0.85)
              ctx.lineTo(ecx - r, ecy + r * 0.85)
              ctx.closePath()
              ctx.fillStyle = ent.color_hex || '#f59e0b'
              ctx.fill()
              ctx.strokeStyle = '#090712'
              ctx.lineWidth = 2
              ctx.stroke()
              ctx.fillStyle = '#090712'
              ctx.font = `900 ${Math.max(11, r * 0.8)}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText('!', ecx, ecy + r * 0.2)
            } else if (ent.kind === 'item') {
              const r = Math.min(ew, eh) * 0.34
              ctx.beginPath()
              ctx.moveTo(ecx, ecy - r)
              ctx.lineTo(ecx + r, ecy)
              ctx.lineTo(ecx, ecy + r)
              ctx.lineTo(ecx - r, ecy)
              ctx.closePath()
              ctx.fillStyle = ent.color_hex || '#06b6d4'
              ctx.fill()
              ctx.strokeStyle = '#ecfeff'
              ctx.lineWidth = 1.8
              ctx.stroke()
            } else if (ent.kind === 'door') {
              ctx.fillStyle = ent.color_hex || '#a16207'
              ctx.fillRect(ex + ew * 0.18, ey + eh * 0.25, ew * 0.64, eh * 0.5)
              ctx.strokeStyle = '#fde68a'
              ctx.lineWidth = 1.8
              ctx.strokeRect(ex + ew * 0.18, ey + eh * 0.25, ew * 0.64, eh * 0.5)
            } else {
              const r = Math.min(ew, eh) * 0.4
              const isEntTurn = Boolean(activeCombatantID && ent.id === activeCombatantID)
              if (isEntTurn) {
                ctx.beginPath()
                ctx.arc(ecx, ecy, r * 1.25, 0, Math.PI * 2)
                ctx.strokeStyle = '#fbbf24'
                ctx.lineWidth = Math.max(2.5, 3.5 / zoom)
                ctx.stroke()
              }
              const entAvatar = getCachedAvatar(ent.avatar_url)
              if (entAvatar) {
                ctx.save()
                ctx.beginPath()
                ctx.arc(ecx, ecy, r, 0, Math.PI * 2)
                ctx.clip()
                ctx.drawImage(entAvatar, ecx - r, ecy - r, r * 2, r * 2)
                ctx.restore()
                ctx.beginPath()
                ctx.arc(ecx, ecy, r, 0, Math.PI * 2)
                ctx.strokeStyle = isSelectedEnt ? '#ffffff' : isEntTurn ? '#fbbf24' : ent.color_hex || '#dc2626'
                ctx.lineWidth = isSelectedEnt ? 3 : 2
                ctx.stroke()
              } else {
                if (ent.kind === 'enemy') {
                  ctx.beginPath()
                  for (let k = 0; k < 8; k++) {
                    const a = (k * Math.PI) / 4 + Math.PI / 8
                    const vx = ecx + Math.cos(a) * r
                    const vy = ecy + Math.sin(a) * r
                    if (k === 0) ctx.moveTo(vx, vy)
                    else ctx.lineTo(vx, vy)
                  }
                  ctx.closePath()
                } else {
                  ctx.beginPath()
                  ctx.arc(ecx, ecy, r, 0, Math.PI * 2)
                }
                ctx.fillStyle = ent.color_hex || (ent.kind === 'enemy' ? '#dc2626' : '#3b82f6')
                ctx.fill()
                ctx.strokeStyle = isSelectedEnt ? '#ffffff' : '#090712'
                ctx.lineWidth = isSelectedEnt ? 3 : 2
                ctx.stroke()

                const tag = ent.name.slice(0, 2).toUpperCase()
                ctx.fillStyle = '#ffffff'
                ctx.font = `800 ${Math.max(10, r * 0.72)}px sans-serif`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(tag, ecx, ecy)
              }
            }

            if (isSelectedEnt) {
              ctx.strokeStyle = '#fde68a'
              ctx.lineWidth = 2.5
              ctx.strokeRect(ex + 1, ey + 1, ew - 2, eh - 2)
            }

            // Condition dots on entity
            if (ent.conditions && ent.conditions.length > 0) {
              ent.conditions.slice(0, 4).forEach((cid, idx) => {
                const cond = DND_CONDITIONS.find((x) => x.id === cid)
                ctx.beginPath()
                ctx.arc(ex + ew - 7 - idx * 10, ey + 8, 4, 0, Math.PI * 2)
                ctx.fillStyle = cond?.color || '#f43f5e'
                ctx.fill()
                ctx.strokeStyle = '#090712'
                ctx.lineWidth = 1
                ctx.stroke()
              })
            }

            if (ent.hp_max > 0 && (isDM || ent.kind === 'enemy' || ent.kind === 'npc')) {
              const barW = ew * 0.76
              const barH = 5
              const bx = ecx - barW / 2
              const by = ey + 3
              const ratio = Math.max(0, Math.min(1, ent.hp_current / ent.hp_max))
              ctx.fillStyle = 'rgba(0,0,0,0.75)'
              ctx.fillRect(bx, by, barW, barH)
              ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444'
              ctx.fillRect(bx, by, barW * ratio, barH)
            }

            if (cellSize * zoom >= 20) {
              ctx.font = `600 ${Math.max(8, Math.min(12, cellSize * 0.22))}px sans-serif`
              const label = (ent.is_hidden ? '👁 ' : '') + (ent.name.length > 13 ? `${ent.name.slice(0, 12)}…` : ent.name)
              const tw = ctx.measureText(label).width + 6
              const th = 13
              ctx.fillStyle = 'rgba(9, 7, 18, 0.85)'
              ctx.fillRect(ecx - tw / 2, ey + eh - th - 1, tw, th)
              ctx.fillStyle = ent.is_hidden ? '#fda4af' : '#e2e8f0'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(label, ecx, ey + eh - th / 2 - 1)
            }

            ctx.restore()
          }

          // Fog of War overlay (Dungeoneer / PlanarAlly style): opaque to players on unrevealed cells, translucent to DM
          if (fogEnabled) {
            ctx.fillStyle = isDM ? 'rgba(15, 10, 35, 0.48)' : '#05030b'
            for (let gx = 0; gx < cols; gx++) {
              for (let gy = 0; gy < rows; gy++) {
                if (!fogRevealedSet.has(`${gx},${gy}`)) {
                  ctx.fillRect(gx * cellSize, gy * cellSize, cellSize + 0.3, cellSize + 0.3)
                }
              }
            }
          }

          // Render Player Tokens on top of fog so players always see revealed allies/self cleanly
          for (const p of players) {
            if (p.token_hidden && !isDM) continue
            if (!isDM && p.id !== localPlayerID && fogEnabled && !fogRevealedSet.has(`${p.token_x},${p.token_y}`)) {
              continue
            }
            const cx = (p.token_x + 0.5) * cellSize
            const cy = (p.token_y + 0.5) * cellSize
            const radius = cellSize * 0.38

            ctx.save()
            if (p.token_hidden) ctx.globalAlpha = 0.45

            if (p.id === (activeCombatantID || activePlayerID)) {
              ctx.beginPath()
              ctx.arc(cx, cy, radius * 1.28, 0, Math.PI * 2)
              ctx.strokeStyle = '#fbbf24'
              ctx.lineWidth = Math.max(2, 3 / zoom)
              ctx.stroke()
            }

            const isTarget = isDM
              ? selectedDMTarget?.kind === 'player' && selectedDMTarget.id === p.id
              : p.id === localPlayerID
            if (isTarget) {
              ctx.beginPath()
              ctx.arc(cx, cy, radius * 1.15, 0, Math.PI * 2)
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth = Math.max(1.5, 2 / zoom)
              ctx.stroke()
            }

            const pAvatar = getCachedAvatar(p.avatar_url)
            if (pAvatar) {
              ctx.save()
              ctx.beginPath()
              ctx.arc(cx, cy, radius, 0, Math.PI * 2)
              ctx.clip()
              ctx.drawImage(pAvatar, cx - radius, cy - radius, radius * 2, radius * 2)
              ctx.restore()
              ctx.beginPath()
              ctx.arc(cx, cy, radius, 0, Math.PI * 2)
              ctx.strokeStyle = p.color_hex || '#a855f7'
              ctx.lineWidth = Math.max(1.6, 2.4 / zoom)
              ctx.stroke()
            } else {
              ctx.beginPath()
              ctx.arc(cx, cy, radius, 0, Math.PI * 2)
              ctx.fillStyle = p.color_hex || '#a855f7'
              ctx.fill()
              ctx.strokeStyle = '#090712'
              ctx.lineWidth = Math.max(1.2, 2 / zoom)
              ctx.stroke()

              const initials = p.name
                .split(/\s+/)
                .slice(0, 2)
                .map((word) => word[0]?.toUpperCase() || '')
                .join('')
              ctx.fillStyle = '#ffffff'
              ctx.font = `bold ${Math.max(8, radius * 0.9)}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(initials || '?', cx, cy)
            }

            // Player Condition badges (top right rim)
            if (p.conditions && p.conditions.length > 0) {
              p.conditions.slice(0, 3).forEach((cid, idx) => {
                const cond = DND_CONDITIONS.find((x) => x.id === cid)
                ctx.beginPath()
                ctx.arc(cx + radius * 0.72 - idx * 9, cy - radius * 0.72, 4.5, 0, Math.PI * 2)
                ctx.fillStyle = cond?.color || '#f43f5e'
                ctx.fill()
                ctx.strokeStyle = '#090712'
                ctx.lineWidth = 1.2
                ctx.stroke()
              })
            }

            if (cellSize * zoom >= 22) {
              ctx.font = `600 ${Math.max(8, Math.min(13, cellSize * 0.24))}px sans-serif`
              ctx.fillStyle = 'rgba(9, 7, 18, 0.85)'
              const label = p.name.length > 12 ? `${p.name.slice(0, 11)}…` : p.name
              const tw = ctx.measureText(label).width + 8
              const th = 14
              ctx.fillRect(cx - tw / 2, cy + radius + 2, tw, th)
              ctx.fillStyle = '#fde68a'
              ctx.fillText(label, cx, cy + radius + 2 + th / 2)
            }

            ctx.restore()
          }

          // Ephemeral Layer: Ogres Freehand Drawings, MapTool 5ft Rulers, AoE Templates, PlanarAlly Pings
          const nowMs = Date.now()
          for (const ev of tempEvents) {
            if (ev.kind === 'draw' && ev.points && ev.points.length > 1) {
              ctx.beginPath()
              ctx.strokeStyle = ev.color || '#38bdf8'
              ctx.lineWidth = 3.5
              ctx.lineCap = 'round'
              ctx.lineJoin = 'round'
              ev.points.forEach((pt, idx) => {
                if (idx === 0) ctx.moveTo(pt.x, pt.y)
                else ctx.lineTo(pt.x, pt.y)
              })
              ctx.stroke()
            } else if (ev.kind === 'aoe' && typeof ev.origin_x === 'number' && typeof ev.origin_y === 'number') {
              const ox = (ev.origin_x + 0.5) * cellSize
              const oy = (ev.origin_y + 0.5) * cellSize
              const radCells = Math.max(1, (ev.radius_ft || 20) / 5)
              const rPx = radCells * cellSize
              ctx.save()
              ctx.fillStyle = `${ev.color || '#f97316'}40`
              ctx.strokeStyle = ev.color || '#f97316'
              ctx.lineWidth = 2.5
              if (ev.shape === 'cube') {
                ctx.fillRect(ox - rPx / 2, oy - rPx / 2, rPx, rPx)
                ctx.strokeRect(ox - rPx / 2, oy - rPx / 2, rPx, rPx)
              } else if (ev.shape === 'cone') {
                const tx = ((ev.target_x ?? ev.origin_x + 1) + 0.5) * cellSize
                const ty = ((ev.target_y ?? ev.origin_y) + 0.5) * cellSize
                const ang = Math.atan2(ty - oy, tx - ox)
                ctx.beginPath()
                ctx.moveTo(ox, oy)
                ctx.arc(ox, oy, rPx, ang - Math.PI / 6, ang + Math.PI / 6)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
              } else if (ev.shape === 'line') {
                const tx = ((ev.target_x ?? ev.origin_x + 3) + 0.5) * cellSize
                const ty = ((ev.target_y ?? ev.origin_y) + 0.5) * cellSize
                ctx.lineWidth = cellSize * 0.75
                ctx.strokeStyle = `${ev.color || '#38bdf8'}55`
                ctx.beginPath()
                ctx.moveTo(ox, oy)
                ctx.lineTo(tx, ty)
                ctx.stroke()
              } else {
                // Sphere / Radius
                ctx.beginPath()
                ctx.arc(ox, oy, rPx, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
              }
              ctx.fillStyle = '#fef3c7'
              ctx.font = 'bold 11px sans-serif'
              ctx.textAlign = 'center'
              ctx.fillText(`${ev.shape?.toUpperCase() || 'AOE'} ${ev.radius_ft || 20}ft`, ox, oy - 6)
              ctx.restore()
            } else if (
              ev.kind === 'ruler' &&
              typeof ev.from_x === 'number' &&
              typeof ev.from_y === 'number' &&
              typeof ev.to_x === 'number' &&
              typeof ev.to_y === 'number' &&
              nowMs - (ev.receivedAt || 0) < 12000
            ) {
              drawRulerLine(ctx, ev.from_x, ev.from_y, ev.to_x, ev.to_y, ev.color || '#38bdf8', cellSize, ev.sender_name)
            } else if (ev.kind === 'ping' && typeof ev.x === 'number' && typeof ev.y === 'number') {
              const age = nowMs - (ev.receivedAt || 0)
              if (age < 3200) {
                const px = (ev.x + 0.5) * cellSize
                const py = (ev.y + 0.5) * cellSize
                const prog = (age % 900) / 900
                const ringR = cellSize * (0.25 + prog * 1.1)
                ctx.save()
                ctx.globalAlpha = Math.max(0.15, 1 - age / 3200)
                ctx.beginPath()
                ctx.arc(px, py, ringR, 0, Math.PI * 2)
                ctx.strokeStyle = ev.color || '#fde047'
                ctx.lineWidth = 3.5
                ctx.stroke()
                if (ev.sender_name) {
                  ctx.fillStyle = '#fde047'
                  ctx.font = 'bold 11px sans-serif'
                  ctx.textAlign = 'center'
                  ctx.fillText(`📍 ${ev.sender_name}`, px, py - ringR - 6)
                }
                ctx.restore()
              }
            }
          }

          // Active local ruler preview while dragging
          if (rulerStart && rulerEnd) {
            drawRulerLine(ctx, rulerStart.x, rulerStart.y, rulerEnd.x, rulerEnd.y, localColor, cellSize, 'Tú')
          }

          // Active local freehand draw stroke while dragging
          if (drawStroke.length > 1) {
            ctx.beginPath()
            ctx.strokeStyle = localColor
            ctx.lineWidth = 3.5
            ctx.lineCap = 'round'
            drawStroke.forEach((pt, idx) => {
              if (idx === 0) ctx.moveTo(pt.x, pt.y)
              else ctx.lineTo(pt.x, pt.y)
            })
            ctx.stroke()
          }

          ctx.restore()
        }
      }
      rafId = window.requestAnimationFrame(render)
    }
    rafId = window.requestAnimationFrame(render)
    return () => window.cancelAnimationFrame(rafId)
  }, [
    session,
    players,
    entities,
    tempEvents,
    cols,
    rows,
    boardWidth,
    boardHeight,
    pan,
    zoom,
    hoverCell,
    activePlayerID,
    localPlayerID,
    localColor,
    isDM,
    tool,
    selectedDMTarget,
    imgLoadedTick,
    fogEnabled,
    rulerStart,
    rulerEnd,
    drawStroke,
  ])

  const screenToBoard = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const bx = (clientX - rect.left - pan.x) / zoom
    const by = (clientY - rect.top - pan.y) / zoom
    return { x: bx, y: by }
  }

  const screenToGrid = (clientX: number, clientY: number) => {
    const pt = screenToBoard(clientX, clientY)
    if (!pt) return null
    const gx = Math.floor(pt.x / LOGICAL_CELL_SIZE)
    const gy = Math.floor(pt.y / LOGICAL_CELL_SIZE)
    if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return null
    return { x: gx, y: gy }
  }

  const applyFogAt = (gx: number, gy: number, mode: 'fog_reveal' | 'fog_hide') => {
    if (!isDM || !onUpdateFog) return
    const key = `${gx},${gy}`
    if (dragRef.current.fogChanged.has(key)) return
    dragRef.current.fogChanged.add(key)

    const next = new Set(session.fog_revealed ?? [])
    if (mode === 'fog_reveal') next.add(key)
    else next.delete(key)
    onUpdateFog(true, Array.from(next))
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const cell = screenToGrid(e.clientX, e.clientY)
    const boardPt = screenToBoard(e.clientX, e.clientY)

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
      moved: false,
      fogChanged: new Set(),
    }

    if (tool === 'ruler' && cell) {
      setRulerStart(cell)
      setRulerEnd(cell)
      return
    }
    if (tool === 'draw' && boardPt) {
      setDrawStroke([boardPt])
      return
    }
    if ((tool === 'fog_reveal' || tool === 'fog_hide') && cell && isDM) {
      applyFogAt(cell.x, cell.y, tool)
      return
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = screenToGrid(e.clientX, e.clientY)
    const boardPt = screenToBoard(e.clientX, e.clientY)
    setHoverCell(cell)
    if (!dragRef.current.active) return

    if (tool === 'ruler') {
      if (cell) setRulerEnd(cell)
      return
    }
    if (tool === 'draw') {
      if (boardPt) setDrawStroke((prev) => [...prev, boardPt])
      return
    }
    if ((tool === 'fog_reveal' || tool === 'fog_hide') && isDM) {
      if (cell) applyFogAt(cell.x, cell.y, tool)
      return
    }

    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.hypot(dx, dy) > 6) {
      dragRef.current.moved = true
      setPan({
        x: dragRef.current.origPanX + dx,
        y: dragRef.current.origPanY + dy,
      })
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return
    const wasMoved = dragRef.current.moved
    dragRef.current.active = false
    const cell = screenToGrid(e.clientX, e.clientY)

    if (tool === 'ruler') {
      if (rulerStart && cell) {
        onTempEvent?.({
          kind: 'ruler',
          from_x: rulerStart.x,
          from_y: rulerStart.y,
          to_x: cell.x,
          to_y: cell.y,
          color: localColor,
          sender_name: localPlayerName,
        })
      }
      setRulerStart(null)
      setRulerEnd(null)
      return
    }

    if (tool === 'draw') {
      if (drawStroke.length > 1) {
        onTempEvent?.({
          kind: 'draw',
          points: drawStroke,
          color: localColor,
          sender_name: localPlayerName,
        })
      }
      setDrawStroke([])
      return
    }

    if (tool === 'fog_reveal' || tool === 'fog_hide') {
      return
    }

    if (!wasMoved && cell) {
      if (tool === 'ping') {
        onTempEvent?.({
          kind: 'ping',
          x: cell.x,
          y: cell.y,
          color: localColor,
          sender_name: localPlayerName,
        })
        return
      }
      if (tool === 'aoe') {
        onTempEvent?.({
          kind: 'aoe',
          shape: aoeShape,
          origin_x: cell.x,
          origin_y: cell.y,
          target_x: cell.x + 2,
          target_y: cell.y,
          radius_ft: aoeRadiusFt,
          color: '#f97316',
          sender_name: localPlayerName,
        })
        return
      }
      if (onEntityClick) {
        const hitEnt = entities.find((ent) => {
          if (ent.is_hidden && !isDM) return false
          const sz = Math.max(1, Math.min(4, ent.size || 1))
          return cell.x >= ent.x && cell.x < ent.x + sz && cell.y >= ent.y && cell.y < ent.y + sz
        })
        if (hitEnt && (!isDM || tool === 'move')) {
          onEntityClick(hitEnt)
          if (!isDM) return
        }
      }
      if (onCellClick) {
        onCellClick(cell.x, cell.y)
      } else if (localPlayerID) {
        onMoveToken(localPlayerID, cell.x, cell.y)
      }
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.12 : 0.89
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setZoom((prevZoom) => {
      const nextZoom = Math.max(0.15, Math.min(4, prevZoom * factor))
      const scale = nextZoom / prevZoom
      setPan((p) => ({
        x: mx - (mx - p.x) * scale,
        y: my - (my - p.y) * scale,
      }))
      return nextZoom
    })
  }

  return (
    <div className="space-y-2.5">
      {/* Unified Tactical Toolbar (MapTool Measure/AoE + PlanarAlly Ping/Fog + Ogres Draw) */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTool('move')}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 border transition ${
              tool === 'move' ? 'bg-violet-600 text-white border-violet-400' : 'bg-[#090712] text-slate-300 border-violet-500/25'
            }`}
          >
            <Hand className="w-3.5 h-3.5" /> Mover
          </button>

          {isDM && (
            <button
              type="button"
              onClick={() => setTool('place')}
              className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 border transition ${
                tool === 'place' ? 'bg-emerald-500 text-slate-950 border-emerald-400' : 'bg-[#090712] text-emerald-300 border-emerald-500/30'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" /> Colocar
            </button>
          )}

          <button
            type="button"
            onClick={() => setTool('ruler')}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 border transition ${
              tool === 'ruler' ? 'bg-sky-500 text-slate-950 border-sky-400' : 'bg-[#090712] text-sky-300 border-sky-500/30'
            }`}
            title="Arrastra para medir pies (5ft/casilla)"
          >
            <Ruler className="w-3.5 h-3.5" /> Regla (5ft)
          </button>

          <button
            type="button"
            onClick={() => setTool('ping')}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 border transition ${
              tool === 'ping' ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-[#090712] text-amber-200 border-amber-500/30'
            }`}
            title="Haz clic para lanzar señal visual a la mesa"
          >
            <Radio className="w-3.5 h-3.5" /> Ping
          </button>

          <button
            type="button"
            onClick={() => setTool('aoe')}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 border transition ${
              tool === 'aoe' ? 'bg-orange-500 text-slate-950 border-orange-400' : 'bg-[#090712] text-orange-300 border-orange-500/30'
            }`}
            title="Colocar plantilla de Área de Efecto"
          >
            <Flame className="w-3.5 h-3.5" /> AoE
          </button>

          <button
            type="button"
            onClick={() => setTool('draw')}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 border transition ${
              tool === 'draw' ? 'bg-cyan-500 text-slate-950 border-cyan-400' : 'bg-[#090712] text-cyan-300 border-cyan-500/30'
            }`}
            title="Trazo vectorial rápido en vivo"
          >
            <Pencil className="w-3.5 h-3.5" /> Dibujar
          </button>

          {isDM && onUpdateFog && (
            <>
              <button
                type="button"
                onClick={() => setTool('fog_reveal')}
                className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 border transition ${
                  tool === 'fog_reveal' ? 'bg-indigo-500 text-white border-indigo-400' : 'bg-[#090712] text-indigo-200 border-indigo-500/30'
                }`}
              >
                <CloudFog className="w-3.5 h-3.5" /> Revelar Niebla
              </button>
              <button
                type="button"
                onClick={() => setTool('fog_hide')}
                className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 border transition ${
                  tool === 'fog_hide' ? 'bg-slate-600 text-white border-slate-400' : 'bg-[#090712] text-slate-300 border-slate-600/40'
                }`}
              >
                <CloudFog className="w-3.5 h-3.5" /> Cubrir
              </button>
            </>
          )}

          {onTempEvent && tempEvents.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onTempEvent({ kind: 'draw', clear: true })
                onTempEvent({ kind: 'aoe', clear: true })
              }}
              className="px-2 py-1.5 rounded-lg bg-[#090712] border border-rose-500/30 text-rose-300 hover:bg-rose-950/40 flex items-center gap-1"
              title="Limpiar dibujos y plantillas"
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Zoom + Grid Coordinates */}
        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="font-mono text-[11px] mr-1">
            <strong className="text-amber-200">{cols}×{rows}</strong>
            {hoverCell && ` (${hoverCell.x + 1},${hoverCell.y + 1})`}
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.15, z * 0.85))}
            className="p-1.5 rounded-lg bg-[#090712] border border-violet-500/30 text-slate-200"
            title="Alejar"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, z * 1.18))}
            className="p-1.5 rounded-lg bg-[#090712] border border-violet-500/30 text-slate-200"
            title="Acercar"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={fitToContainer}
            className="px-2 py-1.5 rounded-lg bg-[#090712] border border-violet-500/30 text-slate-200 flex items-center gap-1"
            title="Centrar"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* AoE Controls when AoE tool active */}
      {tool === 'aoe' && (
        <div className="flex flex-wrap items-center gap-2 bg-[#090712]/80 px-3 py-2 rounded-xl border border-orange-500/30 text-xs">
          <span className="text-orange-300 font-bold">Plantilla AoE:</span>
          {(['sphere', 'cone', 'cube', 'line'] as const).map((sh) => (
            <button
              key={sh}
              type="button"
              onClick={() => setAoeShape(sh)}
              className={`px-2 py-1 rounded font-semibold ${
                aoeShape === sh ? 'bg-orange-500 text-slate-950' : 'bg-[#120d22] text-slate-300'
              }`}
            >
              {sh === 'sphere' ? 'Esfera' : sh === 'cone' ? 'Cono' : sh === 'cube' ? 'Cubo' : 'Línea'}
            </button>
          ))}
          <select
            value={aoeRadiusFt}
            onChange={(e) => setAoeRadiusFt(Number(e.target.value))}
            className="px-2 py-1 rounded bg-[#120d22] border border-orange-500/30 text-amber-200 font-mono"
          >
            {[10, 15, 20, 30, 40, 60].map((ft) => (
              <option key={ft} value={ft}>
                {ft} pies ({ft / 5} cas.)
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-400">Haz clic en la casilla de origen en el mapa.</span>
        </div>
      )}

      {/* Fog Controls for DM */}
      {isDM && onUpdateFog && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#090712]/65 px-3 py-1.5 rounded-xl border border-indigo-500/25 text-[11px]">
          <div className="flex items-center gap-2">
            <CloudFog className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-300 font-semibold">Niebla de Guerra:</span>
            <button
              type="button"
              onClick={() => onUpdateFog(!fogEnabled, session.fog_revealed ?? [])}
              className={`px-2 py-0.5 rounded font-bold ${
                fogEnabled ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {fogEnabled ? 'ACTIVADA' : 'DESACTIVADA'}
            </button>
          </div>
          {fogEnabled && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const all: string[] = []
                  for (let x = 0; x < cols; x++) {
                    for (let y = 0; y < rows; y++) all.push(`${x},${y}`)
                  }
                  onUpdateFog(true, all)
                }}
                className="text-emerald-300 hover:underline"
              >
                Revelar Todo
              </button>
              <button
                type="button"
                onClick={() => onUpdateFog(true, [])}
                className="text-rose-300 hover:underline"
              >
                Cubrir Todo
              </button>
            </div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden bg-[#07050f] touch-none select-none cursor-crosshair ${
          fullViewport
            ? 'h-[calc(100vh-3.5rem)] rounded-none border-0'
            : 'h-[380px] sm:h-[480px] rounded-xl border border-violet-500/30'
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            setHoverCell(null)
            dragRef.current.active = false
          }}
          onWheel={handleWheel}
          className="w-full h-full block"
        />
      </div>
    </div>
  )
}

function drawRulerLine(
  ctx: CanvasRenderingContext2D,
  x1Cell: number,
  y1Cell: number,
  x2Cell: number,
  y2Cell: number,
  color: string,
  cellSize: number,
  sender?: string
) {
  const x1 = (x1Cell + 0.5) * cellSize
  const y1 = (y1Cell + 0.5) * cellSize
  const x2 = (x2Cell + 0.5) * cellSize
  const y2 = (y2Cell + 0.5) * cellSize
  const cellsDist = Math.max(Math.abs(x2Cell - x1Cell), Math.abs(y2Cell - y1Cell))
  const feet = cellsDist * 5

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.setLineDash([7, 5])
  ctx.stroke()
  ctx.setLineDash([])

  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const txt = `${feet} ft (${cellsDist} cas.)${sender ? ` · ${sender}` : ''}`
  ctx.font = 'bold 11px sans-serif'
  const tw = ctx.measureText(txt).width + 10
  ctx.fillStyle = 'rgba(9, 7, 18, 0.9)'
  ctx.fillRect(mx - tw / 2, my - 10, tw, 18)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.strokeRect(mx - tw / 2, my - 10, tw, 18)
  ctx.fillStyle = '#fef3c7'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(txt, mx, my - 1)
  ctx.restore()
}
