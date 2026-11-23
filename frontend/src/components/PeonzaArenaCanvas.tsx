import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw, Sparkles } from 'lucide-react'
import { RollBroadcast, SpinnerDetail } from '../types'
import { triggerBounceHaptic, unlockHaptics } from '../lib/haptics'

interface PeonzaArenaCanvasProps {
  faces: string[]
  lastBroadcast: RollBroadcast | null
  disabled?: boolean
  onSpin: () => void
}

const SLICE_COLORS = [
  '#7c3aed', '#d97706', '#059669', '#2563eb', '#db2777', '#dc2626',
  '#0891b2', '#65a30d', '#9333ea', '#ea580c', '#0d9488', '#4f46e5',
]

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
}

interface PeonzaState {
  phase: 'idle' | 'charging' | 'spinning' | 'settling' | 'landed'
  x: number
  y: number
  vx: number
  vy: number
  spinAngle: number
  omega: number
  tiltMag: number
  precessionAngle: number
  bounces: number
  speedPct: number
  winningIndex: number
  winningLabel: string
  faces: string[]
  sparks: Spark[]
  trail: { x: number; y: number }[]
  wallFlash: { side: 'L' | 'R' | 'T' | 'B' | null; alpha: number }
}

export const PeonzaArenaCanvas: React.FC<PeonzaArenaCanvasProps> = ({
  faces,
  lastBroadcast,
  disabled = false,
  onSpin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastHandledID = useRef<number>(0)

  const [phaseLabel, setPhaseLabel] = useState<string>('idle')
  const [bouncesUI, setBouncesUI] = useState(0)
  const [speedUI, setSpeedUI] = useState(0)
  const [landedLabel, setLandedLabel] = useState<string | null>(null)

  const stateRef = useRef<PeonzaState>({
    phase: 'idle',
    x: 170,
    y: 135,
    vx: 0,
    vy: 0,
    spinAngle: 0,
    omega: 0,
    tiltMag: 0.08,
    precessionAngle: 0,
    bounces: 0,
    speedPct: 0,
    winningIndex: 0,
    winningLabel: '',
    faces,
    sparks: [],
    trail: [],
    wallFlash: { side: null, alpha: 0 },
  })

  // Keep editable faces synced when idle/landed
  useEffect(() => {
    const st = stateRef.current
    if (st.phase === 'idle' || st.phase === 'landed') {
      st.faces = faces
    }
  }, [faces])

  const launchPhysics = useCallback(
    (activeFaces: string[], winIdx: number, winLabel: string, boost = 1) => {
      const st = stateRef.current
      const w = containerRef.current?.clientWidth || 340
      const h = containerRef.current?.clientHeight || 260
      const angle = Math.random() * Math.PI * 2
      const initialSpeed = (290 + Math.random() * 140) * boost

      st.phase = 'spinning'
      st.x = w * 0.5 + (Math.random() - 0.5) * 40
      st.y = h * 0.54 + (Math.random() - 0.5) * 30
      st.vx = Math.cos(angle) * initialSpeed
      st.vy = Math.sin(angle) * initialSpeed
      st.omega = (22 + Math.random() * 7) * boost
      st.tiltMag = 0.14
      st.bounces = 0
      st.winningIndex = winIdx
      st.winningLabel = winLabel
      st.faces = activeFaces
      st.trail = []
      st.sparks = []
      setPhaseLabel('spinning')
      setBouncesUI(0)
      setLandedLabel(null)
    },
    []
  )

  // Listen for server SPINNER result
  useEffect(() => {
    if (!lastBroadcast || lastBroadcast.set_type !== 'SPINNER') return
    if (lastBroadcast.id === lastHandledID.current) return
    lastHandledID.current = lastBroadcast.id

    const detail = lastBroadcast.detail as SpinnerDetail
    if (!detail || typeof detail.winning_index !== 'number' || !detail.faces?.length) return

    launchPhysics(detail.faces, detail.winning_index, detail.label, 1)
  }, [lastBroadcast, launchPhysics])

  // 60 FPS 3D Perspective Rendering & Wall-Bounce Physics Loop
  useEffect(() => {
    let rafId = 0
    let lastTime = performance.now()

    const step = (now: number) => {
      const dt = Math.min(0.033, Math.max(0.001, (now - lastTime) / 1000))
      lastTime = now

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

        const st = stateRef.current
        if (st.x === 0 && st.y === 0) {
          st.x = w / 2
          st.y = h * 0.56
        }

        // Arena bounds inside perspective floor box
        const padX = 46
        const padTop = 58
        const padBottom = 30
        const minX = padX
        const maxX = Math.max(padX + 20, w - padX)
        const minY = padTop
        const maxY = Math.max(padTop + 20, h - padBottom)

        const spawnWallSparks = (sx: number, sy: number, nx: number, ny: number) => {
          for (let i = 0; i < 10; i++) {
            const spread = (Math.random() - 0.5) * 1.4
            const baseAng = Math.atan2(ny, nx) + spread
            const spd = 60 + Math.random() * 140
            st.sparks.push({
              x: sx,
              y: sy,
              vx: Math.cos(baseAng) * spd,
              vy: Math.sin(baseAng) * spd,
              life: 0,
              maxLife: 0.35 + Math.random() * 0.2,
              color: i % 2 === 0 ? '#fde68a' : '#a78bfa',
            })
          }
        }

        if (st.phase === 'charging') {
          st.spinAngle += 24 * dt
          st.precessionAngle += 6 * dt
          st.tiltMag = 0.09
          st.x = Math.min(maxX, Math.max(minX, w * 0.5 + Math.sin(now * 0.012) * 8))
          st.y = Math.min(maxY, Math.max(minY, h * 0.55 + Math.cos(now * 0.015) * 6))
        } else if (st.phase === 'spinning') {
          // Slight random wander drift so path curves unpredictably
          const wander = (Math.random() - 0.5) * 180
          const spdBefore = Math.hypot(st.vx, st.vy)
          if (spdBefore > 10) {
            const curAng = Math.atan2(st.vy, st.vx) + (wander * dt) / 140
            st.vx = Math.cos(curAng) * spdBefore
            st.vy = Math.sin(curAng) * spdBefore
          }

          st.x += st.vx * dt
          st.y += st.vy * dt

          // Gentle continuous floor drag
          const drag = Math.pow(0.84, dt)
          st.vx *= drag
          st.vy *= drag
          st.omega *= Math.pow(0.68, dt)
          st.spinAngle += st.omega * dt
          st.precessionAngle += (4 + st.omega * 0.2) * dt

          // Wall collisions: random angular deflection + speed & omega decay on EVERY bounce!
          let bounced = false
          if (st.x <= minX) {
            st.x = minX
            st.vx = Math.abs(st.vx)
            bounced = true
            st.wallFlash = { side: 'L', alpha: 1 }
            spawnWallSparks(minX, st.y, 1, 0)
          } else if (st.x >= maxX) {
            st.x = maxX
            st.vx = -Math.abs(st.vx)
            bounced = true
            st.wallFlash = { side: 'R', alpha: 1 }
            spawnWallSparks(maxX, st.y, -1, 0)
          }
          if (st.y <= minY) {
            st.y = minY
            st.vy = Math.abs(st.vy)
            bounced = true
            st.wallFlash = { side: 'T', alpha: 1 }
            spawnWallSparks(st.x, minY, 0, 1)
          } else if (st.y >= maxY) {
            st.y = maxY
            st.vy = -Math.abs(st.vy)
            bounced = true
            st.wallFlash = { side: 'B', alpha: 1 }
            spawnWallSparks(st.x, maxY, 0, -1)
          }

          if (bounced) {
            // Deflect bounce trajectory randomly (±18 deg) & decay BOTH linear and rotational speeds!
            const deflect = (Math.random() - 0.5) * 0.62
            const cosD = Math.cos(deflect)
            const sinD = Math.sin(deflect)
            const nvx = st.vx * cosD - st.vy * sinD
            const nvy = st.vx * sinD + st.vy * cosD
            st.vx = nvx * 0.72
            st.vy = nvy * 0.72
            st.omega *= 0.80
            st.bounces += 1
            setBouncesUI(st.bounces)
            triggerBounceHaptic('medium')
          }

          const currentSpeed = Math.hypot(st.vx, st.vy)
          // Precession wobble grows as spin slows down
          st.tiltMag = Math.min(0.45, 0.08 + (1 - Math.min(1, st.omega / 22)) * 0.34)
          st.speedPct = Math.min(100, Math.round((st.omega / 24) * 100))
          setSpeedUI(st.speedPct)

          st.trail.push({ x: st.x, y: st.y })
          if (st.trail.length > 26) st.trail.shift()

          if (st.omega < 3.6 && currentSpeed < 55) {
            st.phase = 'settling'
            setPhaseLabel('settling')
          }
        } else if (st.phase === 'settling') {
          const n = Math.max(4, st.faces.length)
          const sliceStep = (Math.PI * 2) / n
          // Target angle so facet `winningIndex` faces straight forward toward the camera (+Z => angle = 0)
          const targetCenterOffset = (st.winningIndex + 0.5) * sliceStep
          const desiredMod = ((-targetCenterOffset) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
          const curMod = ((st.spinAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
          let diff = desiredMod - curMod
          if (diff < -Math.PI) diff += Math.PI * 2
          if (diff > Math.PI) diff -= Math.PI * 2

          st.spinAngle += diff * Math.min(1, dt * 6.5)
          st.vx *= Math.pow(0.15, dt)
          st.vy *= Math.pow(0.15, dt)
          st.x += st.vx * dt
          st.y += st.vy * dt
          // Lean dramatically to rest on the side showing winning facet
          st.tiltMag += (0.58 - st.tiltMag) * Math.min(1, dt * 5)
          const pMod = ((st.precessionAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
          const pDiff = pMod > Math.PI ? Math.PI * 2 - pMod : -pMod
          st.precessionAngle += pDiff * Math.min(1, dt * 5)
          setSpeedUI(Math.max(0, Math.round(Math.abs(diff) * 20)))

          if (Math.abs(diff) < 0.025 && Math.abs(st.tiltMag - 0.58) < 0.03) {
            st.spinAngle = curMod + diff
            st.tiltMag = 0.58
            st.vx = 0
            st.vy = 0
            st.omega = 0
            st.phase = 'landed'
            setSpeedUI(0)
            setPhaseLabel('landed')
            setLandedLabel(st.winningLabel)
            triggerBounceHaptic('heavy')
          }
        }

        // Update sparks & wall flash
        st.wallFlash.alpha = Math.max(0, st.wallFlash.alpha - dt * 3.5)
        st.sparks = st.sparks.filter((sp) => {
          sp.life += dt
          sp.x += sp.vx * dt
          sp.y += sp.vy * dt
          sp.vx *= 0.94
          sp.vy *= 0.94
          return sp.life < sp.maxLife
        })

        // ---------------- RENDER 3D PERSPECTIVE SCENE ----------------
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, w, h)

          // Deep background
          const bgGrad = ctx.createLinearGradient(0, 0, 0, h)
          bgGrad.addColorStop(0, '#090712')
          bgGrad.addColorStop(1, '#140d29')
          ctx.fillStyle = bgGrad
          ctx.fillRect(0, 0, w, h)

          // Perspective Floor Grid inside the bounding walls
          const wallTopY = 44
          const wallBotY = h - 18
          const topInset = 34
          const botInset = 14

          // Floor quad
          ctx.beginPath()
          ctx.moveTo(topInset, wallTopY)
          ctx.lineTo(w - topInset, wallTopY)
          ctx.lineTo(w - botInset, wallBotY)
          ctx.lineTo(botInset, wallBotY)
          ctx.closePath()
          ctx.fillStyle = '#0e091f'
          ctx.fill()
          ctx.strokeStyle = 'rgba(139, 92, 246, 0.45)'
          ctx.lineWidth = 2
          ctx.stroke()

          // Perspective grid lines on floor
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(topInset, wallTopY)
          ctx.lineTo(w - topInset, wallTopY)
          ctx.lineTo(w - botInset, wallBotY)
          ctx.lineTo(botInset, wallBotY)
          ctx.closePath()
          ctx.clip()

          ctx.strokeStyle = 'rgba(167, 139, 250, 0.14)'
          ctx.lineWidth = 1
          const cols = 8
          for (let i = 1; i < cols; i++) {
            const t = i / cols
            const tx = topInset + t * (w - 2 * topInset)
            const bx = botInset + t * (w - 2 * botInset)
            ctx.beginPath()
            ctx.moveTo(tx, wallTopY)
            ctx.lineTo(bx, wallBotY)
            ctx.stroke()
          }
          const rows = 6
          for (let j = 1; j < rows; j++) {
            const t = Math.pow(j / rows, 1.25)
            const gy = wallTopY + t * (wallBotY - wallTopY)
            const leftX = topInset + t * (botInset - topInset)
            const rightX = w - topInset - t * (botInset - topInset)
            ctx.beginPath()
            ctx.moveTo(leftX, gy)
            ctx.lineTo(rightX, gy)
            ctx.stroke()
          }

          // Active trajectory trail
          if (st.trail.length > 1) {
            ctx.beginPath()
            for (let i = 0; i < st.trail.length; i++) {
              const pt = st.trail[i]
              if (i === 0) ctx.moveTo(pt.x, pt.y)
              else ctx.lineTo(pt.x, pt.y)
            }
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)'
            ctx.lineWidth = 2.5
            ctx.stroke()
          }
          ctx.restore()

          // Highlight wall impact flash
          if (st.wallFlash.alpha > 0 && st.wallFlash.side) {
            ctx.save()
            ctx.strokeStyle = `rgba(251, 191, 36, ${st.wallFlash.alpha})`
            ctx.lineWidth = 4
            ctx.beginPath()
            if (st.wallFlash.side === 'L') {
              ctx.moveTo(topInset, wallTopY)
              ctx.lineTo(botInset, wallBotY)
            } else if (st.wallFlash.side === 'R') {
              ctx.moveTo(w - topInset, wallTopY)
              ctx.lineTo(w - botInset, wallBotY)
            } else if (st.wallFlash.side === 'T') {
              ctx.moveTo(topInset, wallTopY)
              ctx.lineTo(w - topInset, wallTopY)
            } else {
              ctx.moveTo(botInset, wallBotY)
              ctx.lineTo(w - botInset, wallBotY)
            }
            ctx.stroke()
            ctx.restore()
          }

          // Draw 3D Perspective Peonza at (st.x, st.y)
          drawPerspectivePeonza(ctx, st)

          // Sparks
          for (const sp of st.sparks) {
            const alpha = 1 - sp.life / sp.maxLife
            ctx.fillStyle = sp.color
            ctx.globalAlpha = Math.max(0, alpha)
            ctx.beginPath()
            ctx.arc(sp.x, sp.y, 2.5, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.globalAlpha = 1
        }
      }
      rafId = window.requestAnimationFrame(step)
    }

    rafId = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(rafId)
  }, [])

  const startCharge = () => {
    if (disabled) return
    unlockHaptics()
    const st = stateRef.current
    if (st.phase === 'spinning' || st.phase === 'settling') return
    st.phase = 'charging'
    setPhaseLabel('charging')
    setLandedLabel(null)
  }

  const releaseSpin = () => {
    if (disabled) return
    const st = stateRef.current
    if (st.phase === 'charging' || st.phase === 'idle' || st.phase === 'landed') {
      onSpin()
    }
  }

  return (
    <div className="flex flex-col items-center space-y-3 w-full">
      <div
        ref={containerRef}
        onPointerDown={startCharge}
        onPointerUp={releaseSpin}
        onPointerCancel={() => {
          if (stateRef.current.phase === 'charging') {
            stateRef.current.phase = 'idle'
            setPhaseLabel('idle')
          }
        }}
        className="relative w-full h-64 sm:h-72 rounded-2xl overflow-hidden border border-violet-500/35 shadow-xl shadow-violet-950/60 touch-none select-none cursor-pointer"
      >
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Live Telemetry Overlay */}
        <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between text-[11px] pointer-events-none">
          <span className="px-2 py-0.5 rounded-full bg-black/60 border border-violet-500/30 text-violet-200 font-mono">
            Rebotes: <strong className="text-amber-300">{bouncesUI}</strong>
          </span>
          <span className="px-2 py-0.5 rounded-full bg-black/60 border border-violet-500/30 text-slate-300 font-mono">
            Giro: <strong className="text-emerald-300">{speedUI}%</strong>
          </span>
        </div>

        <div className="absolute bottom-2 inset-x-0 text-center text-[10px] text-slate-400 pointer-events-none">
          Toca o mantén presionado el tablero para lanzar la peonza en perspectiva 3D
        </div>
      </div>

      <button
        type="button"
        disabled={disabled || phaseLabel === 'spinning' || phaseLabel === 'settling' || faces.length < 4}
        onClick={() => {
          unlockHaptics()
          onSpin()
        }}
        className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-white font-bold text-sm shadow-lg transition disabled:opacity-45 flex items-center gap-2"
      >
        <RotateCw className={`w-4 h-4 ${phaseLabel === 'spinning' ? 'animate-spin' : ''}`} />
        {phaseLabel === 'spinning' || phaseLabel === 'settling'
          ? 'Peonza rebotando...'
          : `Girar Peonza (${faces.length} caras)`}
      </button>

      {landedLabel && (
        <div className="text-sm font-extrabold text-amber-200 flex items-center gap-1.5 bg-amber-500/10 border border-amber-400/40 px-3.5 py-1.5 rounded-xl">
          <Sparkles className="w-4 h-4 text-amber-400" />
          Cayó en: {landedLabel}
        </div>
      )}
    </div>
  )
}

function drawPerspectivePeonza(ctx: CanvasRenderingContext2D, st: PeonzaState) {
  const n = Math.max(4, st.faces.length)
  const sliceStep = (Math.PI * 2) / n
  const R = 36

  // Tilt axis from vertical (precession + wobble)
  const tiltX = Math.sin(st.precessionAngle) * st.tiltMag
  const tiltZ = Math.cos(st.precessionAngle) * st.tiltMag

  // Project 3D point relative to peonza tip at floor (0, 0, 0) into 2D screen coordinates
  // Camera looks from front-above: pitch = 0.56 rad (~32 deg)
  const camPitch = 0.56
  const cosP = Math.cos(camPitch)
  const sinP = Math.sin(camPitch)

  const project = (lx: number, ly: number, lz: number) => {
    // Rotate local axis by tiltX (around Z) and tiltZ (around X)
    const cx = Math.cos(tiltX)
    const sx = Math.sin(tiltX)
    const x1 = lx * cx - ly * sx
    const y1 = lx * sx + ly * cx
    const z1 = lz

    const cz = Math.cos(tiltZ)
    const sz = Math.sin(tiltZ)
    const x2 = x1
    const y2 = y1 * cz - z1 * sz
    const z2 = y1 * sz + z1 * cz

    // Apply camera view pitch: +y is up, +z is toward camera
    const screenX = st.x + x2
    const screenY = st.y - (y2 * cosP + z2 * sinP)
    const depth = z2 * cosP - y2 * sinP
    return { x: screenX, y: screenY, z: depth }
  }

  // Floor shadow ellipse
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(st.x + tiltX * 22, st.y + 5, 28 + st.tiltMag * 18, 12 + st.tiltMag * 6, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fill()
  ctx.restore()

  const tip = project(0, 0, 0)
  const capTop = project(0, 44, 0)
  const stemBase = project(0, 42, 0)
  const stemTop = project(0, 62, 0)

  // Build ring vertices for drum bottom (y=16) and drum top (y=36)
  const botRing: { x: number; y: number; z: number }[] = []
  const topRing: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < n; i++) {
    const theta = st.spinAngle + i * sliceStep
    const rx = Math.sin(theta) * R
    const rz = Math.cos(theta) * R
    botRing.push(project(rx, 16, rz))
    topRing.push(project(rx * 1.04, 34, rz * 1.04))
  }

  // Collect all drawable 3D faces for painter's algorithm depth sorting
  interface DrawFace {
    depth: number
    draw: () => void
  }
  const drawList: DrawFace[] = []

  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n
    const b0 = botRing[i]
    const b1 = botRing[next]
    const t1 = topRing[next]
    const t0 = topRing[i]
    const color = SLICE_COLORS[i % SLICE_COLORS.length]
    const label = st.faces[i] || `${i + 1}`
    const isWinner = st.phase === 'landed' && i === st.winningIndex

    // Lower cone triangle (tip -> b0 -> b1)
    const coneDepth = (tip.z + b0.z + b1.z) / 3
    drawList.push({
      depth: coneDepth - 1,
      draw: () => {
        ctx.beginPath()
        ctx.moveTo(tip.x, tip.y)
        ctx.lineTo(b0.x, b0.y)
        ctx.lineTo(b1.x, b1.y)
        ctx.closePath()
        ctx.fillStyle = '#1e133b'
        ctx.fill()
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)'
        ctx.lineWidth = 1
        ctx.stroke()
      },
    })

    // Upper cap triangle (capTop -> t1 -> t0)
    const capDepth = (capTop.z + t0.z + t1.z) / 3
    drawList.push({
      depth: capDepth,
      draw: () => {
        ctx.beginPath()
        ctx.moveTo(capTop.x, capTop.y)
        ctx.lineTo(t1.x, t1.y)
        ctx.lineTo(t0.x, t0.y)
        ctx.closePath()
        ctx.fillStyle = isWinner ? '#fde68a' : '#2d1c59'
        ctx.fill()
        ctx.strokeStyle = '#090712'
        ctx.lineWidth = 1
        ctx.stroke()
      },
    })

    // Side labeled facet (b0 -> b1 -> t1 -> t0)
    const cross = (b1.x - b0.x) * (t0.y - b0.y) - (b1.y - b0.y) * (t0.x - b0.x)
    const sideDepth = (b0.z + b1.z + t1.z + t0.z) / 4
    // Check front-facing visibility using depth relative to center
    if (sideDepth > -R * 0.25 || cross !== 0) {
      drawList.push({
        depth: sideDepth + 2,
        draw: () => {
          ctx.beginPath()
          ctx.moveTo(b0.x, b0.y)
          ctx.lineTo(b1.x, b1.y)
          ctx.lineTo(t1.x, t1.y)
          ctx.lineTo(t0.x, t0.y)
          ctx.closePath()
          ctx.fillStyle = color
          ctx.fill()
          ctx.strokeStyle = isWinner ? '#fde68a' : '#090712'
          ctx.lineWidth = isWinner ? 2.5 : 1.5
          ctx.stroke()

          // Draw text on front-facing facets
          if (sideDepth > 4) {
            const cx = (b0.x + b1.x + t1.x + t0.x) / 4
            const cy = (b0.y + b1.y + t1.y + t0.y) / 4
            const edgeWidth = Math.hypot(b1.x - b0.x, b1.y - b0.y)
            if (edgeWidth > 12) {
              ctx.save()
              const angle = Math.atan2(b1.y - b0.y, b1.x - b0.x)
              ctx.translate(cx, cy)
              ctx.rotate(angle)
              ctx.fillStyle = '#ffffff'
              ctx.font = `bold ${Math.max(7, Math.min(11, edgeWidth * 0.24))}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              const txt = label.length > 9 ? `${label.slice(0, 8)}…` : label
              ctx.fillText(txt, 0, 0)
              ctx.restore()
            }
          }
        },
      })
    }
  }

  // Stem / Pirinola handle
  drawList.push({
    depth: Math.max(stemBase.z, stemTop.z) + 3,
    draw: () => {
      ctx.beginPath()
      ctx.moveTo(stemBase.x, stemBase.y)
      ctx.lineTo(stemTop.x, stemTop.y)
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 6
      ctx.lineCap = 'round'
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(stemTop.x, stemTop.y, 5.5, 0, Math.PI * 2)
      ctx.fillStyle = '#fde68a'
      ctx.fill()
      ctx.strokeStyle = '#090712'
      ctx.lineWidth = 1.5
      ctx.stroke()
    },
  })

  // Metallic floor tip point
  drawList.push({
    depth: tip.z + 1,
    draw: () => {
      ctx.beginPath()
      ctx.arc(tip.x, tip.y, 3.2, 0, Math.PI * 2)
      ctx.fillStyle = '#fde68a'
      ctx.fill()
    },
  })

  // Sort back-to-front by Z depth
  drawList.sort((a, b) => a.depth - b.depth)
  for (const item of drawList) {
    item.draw()
  }
}
