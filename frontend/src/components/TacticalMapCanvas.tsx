import React, { useEffect, useRef, useState } from 'react'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { Player, SessionConfig } from '../types'

interface TacticalMapCanvasProps {
  session: SessionConfig
  players: Player[]
  localPlayerID: string
  activePlayerID: string
  isDM?: boolean
  selectedDMPlayerID?: string
  onMoveToken: (playerID: string, x: number, y: number) => void
}

const LOGICAL_BOARD_SIZE = 1000

export const TacticalMapCanvas: React.FC<TacticalMapCanvasProps> = ({
  session,
  players,
  localPlayerID,
  activePlayerID,
  isDM = false,
  selectedDMPlayerID,
  onMoveToken,
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

  const fitToContainer = () => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const minSide = Math.min(rect.width, rect.height)
    const initialZoom = Math.max(0.4, Math.min(1.5, minSide / LOGICAL_BOARD_SIZE))
    setZoom(initialZoom)
    setPan({
      x: (rect.width - LOGICAL_BOARD_SIZE * initialZoom) / 2,
      y: (rect.height - LOGICAL_BOARD_SIZE * initialZoom) / 2,
    })
  }

  useEffect(() => {
    fitToContainer()
    const onResize = () => fitToContainer()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // High-performance requestAnimationFrame Canvas render loop (supports 50x50 = 2,500 cells at 60fps)
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

          const cols = Math.max(5, Math.min(50, session.map_cols || 10))
          const rows = Math.max(5, Math.min(50, session.map_rows || 10))
          const cellW = LOGICAL_BOARD_SIZE / cols
          const cellH = LOGICAL_BOARD_SIZE / rows

          // Board backdrop
          ctx.fillStyle = '#120d22'
          ctx.fillRect(0, 0, LOGICAL_BOARD_SIZE, LOGICAL_BOARD_SIZE)

          // Custom map background image
          if (bgImgRef.current) {
            ctx.drawImage(bgImgRef.current, 0, 0, LOGICAL_BOARD_SIZE, LOGICAL_BOARD_SIZE)
          }

          // Hover cell highlight
          if (hoverCell && hoverCell.x >= 0 && hoverCell.x < cols && hoverCell.y >= 0 && hoverCell.y < rows) {
            ctx.fillStyle = 'rgba(251, 191, 36, 0.2)'
            ctx.fillRect(hoverCell.x * cellW, hoverCell.y * cellH, cellW, cellH)
          }

          // Grid lines (drawn in single batched path for 60fps even at 50x50)
          ctx.beginPath()
          ctx.strokeStyle = session.map_grid_color || '#ffffff'
          ctx.globalAlpha = session.map_grid_opacity ?? 0.35
          ctx.lineWidth = Math.max(0.75, 1.2 / zoom)
          for (let c = 0; c <= cols; c++) {
            const x = c * cellW
            ctx.moveTo(x, 0)
            ctx.lineTo(x, LOGICAL_BOARD_SIZE)
          }
          for (let r = 0; r <= rows; r++) {
            const y = r * cellH
            ctx.moveTo(0, y)
            ctx.lineTo(LOGICAL_BOARD_SIZE, y)
          }
          ctx.stroke()
          ctx.globalAlpha = 1

          // Outer border
          ctx.strokeStyle = '#7c3aed'
          ctx.lineWidth = 3 / zoom
          ctx.strokeRect(0, 0, LOGICAL_BOARD_SIZE, LOGICAL_BOARD_SIZE)

          // Draw player tokens
          for (const p of players) {
            if (p.token_hidden && !isDM) continue
            const cx = (p.token_x + 0.5) * cellW
            const cy = (p.token_y + 0.5) * cellH
            const radius = Math.min(cellW, cellH) * 0.38

            ctx.save()
            if (p.token_hidden) {
              ctx.globalAlpha = 0.45
            }

            // Active turn halo
            if (p.id === activePlayerID) {
              ctx.beginPath()
              ctx.arc(cx, cy, radius * 1.28, 0, Math.PI * 2)
              ctx.strokeStyle = '#fbbf24'
              ctx.lineWidth = Math.max(2, 3 / zoom)
              ctx.stroke()
            }

            // Self / DM selected halo
            const isTarget = isDM ? p.id === selectedDMPlayerID : p.id === localPlayerID
            if (isTarget) {
              ctx.beginPath()
              ctx.arc(cx, cy, radius * 1.15, 0, Math.PI * 2)
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth = Math.max(1.5, 2 / zoom)
              ctx.stroke()
            }

            // Token circle
            ctx.beginPath()
            ctx.arc(cx, cy, radius, 0, Math.PI * 2)
            ctx.fillStyle = p.color_hex || '#a855f7'
            ctx.fill()
            ctx.strokeStyle = '#090712'
            ctx.lineWidth = Math.max(1.2, 2 / zoom)
            ctx.stroke()

            // Initials
            const initials = p.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() || '')
              .join('')
            ctx.fillStyle = '#ffffff'
            ctx.font = `bold ${Math.max(7, radius * 0.9)}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(initials || '?', cx, cy)

            // Name tag below token when zoom makes it readable
            if (cellW * zoom >= 24) {
              ctx.font = `600 ${Math.max(8, Math.min(13, cellW * 0.24))}px sans-serif`
              ctx.fillStyle = 'rgba(9, 7, 18, 0.82)'
              const label = p.name.length > 12 ? `${p.name.slice(0, 11)}…` : p.name
              const tw = ctx.measureText(label).width + 8
              const th = Math.max(11, cellW * 0.28)
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
  }, [session, players, pan, zoom, hoverCell, activePlayerID, localPlayerID, isDM, selectedDMPlayerID, imgLoadedTick])

  const screenToGrid = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const cols = Math.max(5, Math.min(50, session.map_cols || 10))
    const rows = Math.max(5, Math.min(50, session.map_rows || 10))
    const cellW = LOGICAL_BOARD_SIZE / cols
    const cellH = LOGICAL_BOARD_SIZE / rows
    const gx = Math.floor((px - pan.x) / (zoom * cellW))
    const gy = Math.floor((py - pan.y) / (zoom * cellH))
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
        const targetID = isDM ? selectedDMPlayerID || '' : localPlayerID
        if (targetID) {
          onMoveToken(targetID, cell.x, cell.y)
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
      const nextZoom = Math.max(0.25, Math.min(4, prevZoom * factor))
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
          Cuadrícula: <strong className="text-amber-200">{session.map_cols} × {session.map_rows}</strong>{' '}
          {hoverCell && (
            <span className="ml-2 text-violet-300 font-mono">
              Celda ({hoverCell.x + 1}, {hoverCell.y + 1})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, z * 0.85))}
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
        className="relative w-full h-[360px] sm:h-[460px] rounded-xl overflow-hidden border border-violet-500/30 bg-[#07050f] touch-none select-none cursor-crosshair"
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
        Toca o haz clic en cualquier celda para mover {isDM ? 'la ficha seleccionada' : 'tu ficha'}. Arrastra para desplazar y usa la rueda para hacer zoom.
      </p>
    </div>
  )
}
