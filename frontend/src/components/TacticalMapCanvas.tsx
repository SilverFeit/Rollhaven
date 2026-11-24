import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { MapEntity, Player, SessionConfig } from '../types'

export interface DMSelection {
  kind: 'player' | 'entity'
  id: string
}

interface TacticalMapCanvasProps {
  session: SessionConfig
  players: Player[]
  entities?: MapEntity[]
  localPlayerID: string
  activePlayerID: string
  isDM?: boolean
  dmMode?: 'move' | 'place'
  selectedDMTarget?: DMSelection | null
  onMoveToken: (playerID: string, x: number, y: number) => void
  onCellClick?: (x: number, y: number) => void
}

// Each tactical cell is strictly 1:1 square in logical canvas units;
// the outer board adapts its aspect ratio to (cols * CELL_SIZE) x (rows * CELL_SIZE).
const LOGICAL_CELL_SIZE = 50

export const TacticalMapCanvas: React.FC<TacticalMapCanvasProps> = ({
  session,
  players,
  entities = [],
  localPlayerID,
  activePlayerID,
  isDM = false,
  dmMode = 'move',
  selectedDMTarget = null,
  onMoveToken,
  onCellClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bgImgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoadedTick, setImgLoadedTick] = useState(0)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null)

  const dragRef = useRef<{
    active: boolean
    startX: number
    startY: number
    origPanX: number
    origPanY: number
    moved: boolean
  }>({ active: false, startX: 0, startY: 0, origPanX: 0, origPanY: 0, moved: false })

  const cols = Math.max(5, Math.min(50, session.map_cols || 10))
  const rows = Math.max(5, Math.min(50, session.map_rows || 10))
  const boardWidth = cols * LOGICAL_CELL_SIZE
  const boardHeight = rows * LOGICAL_CELL_SIZE

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

          // Background map image scaled cleanly to rectangular board bounds
          if (bgImgRef.current) {
            ctx.drawImage(bgImgRef.current, 0, 0, boardWidth, boardHeight)
          }

          // Hover cell highlight
          if (hoverCell && hoverCell.x >= 0 && hoverCell.x < cols && hoverCell.y >= 0 && hoverCell.y < rows) {
            ctx.fillStyle =
              isDM && dmMode === 'place' ? 'rgba(16, 185, 129, 0.28)' : 'rgba(251, 191, 36, 0.22)'
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

          // Render DM-placed Map Entities (hazards/doors first, then traps/items/NPCs/enemies)
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
            if (ent.is_hidden) {
              ctx.globalAlpha = 0.5
            }

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
              // Enemy or NPC token spanning size x size cells
              const r = Math.min(ew, eh) * 0.4
              if (ent.kind === 'enemy') {
                // Octagonal hostile token
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
                // Shield/circle NPC token
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

            if (isSelectedEnt) {
              ctx.strokeStyle = '#fde68a'
              ctx.lineWidth = 2.5
              ctx.strokeRect(ex + 1, ey + 1, ew - 2, eh - 2)
            }

            // HP bar for entities with hp_max > 0
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

            // Entity label when legible
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

          // Render Player Tokens
          for (const p of players) {
            if (p.token_hidden && !isDM) continue
            const cx = (p.token_x + 0.5) * cellSize
            const cy = (p.token_y + 0.5) * cellSize
            const radius = cellSize * 0.38

            ctx.save()
            if (p.token_hidden) {
              ctx.globalAlpha = 0.45
            }

            if (p.id === activePlayerID) {
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
    cols,
    rows,
    boardWidth,
    boardHeight,
    pan,
    zoom,
    hoverCell,
    activePlayerID,
    localPlayerID,
    isDM,
    dmMode,
    selectedDMTarget,
    imgLoadedTick,
  ])

  const screenToGrid = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const gx = Math.floor((px - pan.x) / (zoom * LOGICAL_CELL_SIZE))
    const gy = Math.floor((py - pan.y) / (zoom * LOGICAL_CELL_SIZE))
    if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return null
    return { x: gx, y: gy }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
      moved: false,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setHoverCell(screenToGrid(e.clientX, e.clientY))
    if (!dragRef.current.active) return
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
    if (!wasMoved) {
      const cell = screenToGrid(e.clientX, e.clientY)
      if (cell) {
        if (onCellClick) {
          onCellClick(cell.x, cell.y)
        } else if (localPlayerID) {
          onMoveToken(localPlayerID, cell.x, cell.y)
        }
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div>
          Cuadrícula (celdas 1:1):{' '}
          <strong className="text-amber-200">
            {cols} × {rows}
          </strong>{' '}
          <span className="text-[11px] text-slate-500">
            ({cols === rows ? 'Cuadrado' : cols > rows ? 'Horizontal' : 'Vertical'})
          </span>
          {hoverCell && (
            <span className="ml-2 text-violet-300 font-mono">
              Celda ({hoverCell.x + 1}, {hoverCell.y + 1})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.15, z * 0.85))}
            className="p-1.5 rounded-lg bg-[#090712] border border-violet-500/30 hover:border-amber-400/50 text-slate-200"
            title="Alejar"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, z * 1.18))}
            className="p-1.5 rounded-lg bg-[#090712] border border-violet-500/30 hover:border-amber-400/50 text-slate-200"
            title="Acercar"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={fitToContainer}
            className="px-2 py-1.5 rounded-lg bg-[#090712] border border-violet-500/30 hover:border-amber-400/50 text-slate-200 flex items-center gap-1"
            title="Centrar mapa"
          >
            <Maximize2 className="w-3.5 h-3.5" /> Centrar
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full h-[380px] sm:h-[480px] rounded-xl overflow-hidden border border-violet-500/30 bg-[#07050f] touch-none select-none cursor-crosshair"
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
      <p className="text-[11px] text-slate-400">
        {isDM
          ? dmMode === 'place'
            ? 'Modo Colocar: haz clic en cualquier casilla cuadrada para agregar el enemigo, trampa o ítem configurado.'
            : 'Modo Mover: selecciona una ficha o elemento y haz clic en una casilla para moverlo. Arrastra para desplazar el mapa.'
          : 'Toca o haz clic en cualquier celda cuadrada para mover tu ficha. Arrastra para desplazar y usa la rueda para hacer zoom.'}
      </p>
    </div>
  )
}
