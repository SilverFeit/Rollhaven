import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Hand, ShieldCheck, Smartphone, Sparkles } from 'lucide-react'
import { DiceDetail, RollBroadcast } from '../types'
import { supportsHardwareVibration, triggerBounceHaptic, triggerGestureHaptic, unlockHaptics } from '../lib/haptics'

interface DicePhysicsArenaProps {
  selectedSides: number
  diceCount: number
  externalHolding?: boolean
  disabled?: boolean
  lastBroadcast: RollBroadcast | null
  onRollCompleteRequest: (sides: number) => void
}

interface DieBody {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  omega: number
  radius: number
  sides: number
  displayValue: number
  targetValue: number | null
  flipTimer: number
}

interface CollisionSpark {
  x: number
  y: number
  r: number
  maxR: number
  alpha: number
  color: string
}

type ArenaPhase = 'idle' | 'shaking' | 'rolling' | 'settled'

function blurFocusedInputs() {
  try {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    window.getSelection()?.removeAllRanges()
  } catch {
    // Ignore selection errors
  }
}

export const DicePhysicsArena: React.FC<DicePhysicsArenaProps> = ({
  selectedSides,
  diceCount,
  externalHolding = false,
  disabled = false,
  lastBroadcast,
  onRollCompleteRequest,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastHandledID = useRef<number>(0)

  const [phaseUI, setPhaseUI] = useState<ArenaPhase>('idle')
  const [sensorStatus, setSensorStatus] = useState<'off' | 'active' | 'needs_https' | 'denied' | 'unsupported'>('off')
  const [sensorNotice, setSensorNotice] = useState<string | null>(null)
  const [collisionCount, setCollisionCount] = useState(0)

  const holdingRef = useRef(false)
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null)
  const shakeStopTimerRef = useRef<number | null>(null)
  const isPhoneShakingRef = useRef(false)
  const preservedFromShakeRef = useRef(false)
  const lastGravRef = useRef<{ x: number; y: number; z: number } | null>(null)
  const lastOrientRef = useRef<{ beta: number; gamma: number } | null>(null)

  const physicsRef = useRef<{
    phase: ArenaPhase
    dice: DieBody[]
    sparks: CollisionSpark[]
    rollElapsed: number
    sides: number
    collisions: number
    lastDetail: DiceDetail | null
  }>({
    phase: 'idle',
    dice: [],
    sparks: [],
    rollElapsed: 0,
    sides: selectedSides,
    collisions: 0,
    lastDetail: null,
  })

  const buildDiceBodies = useCallback((count: number, sides: number, size: number): DieBody[] => {
    const safeCount = Math.max(1, Math.min(20, count))
    const radius = safeCount <= 2 ? 26 : safeCount <= 6 ? 22 : safeCount <= 12 ? 18 : 15
    const cols = Math.ceil(Math.sqrt(safeCount))
    const rows = Math.ceil(safeCount / cols)
    const bodies: DieBody[] = []

    for (let i = 0; i < safeCount; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = ((col + 1) / (cols + 1)) * size + (Math.random() - 0.5) * 14
      const cy = ((row + 1) / (rows + 1)) * size + (Math.random() - 0.5) * 14
      bodies.push({
        id: i,
        x: Math.max(radius + 8, Math.min(size - radius - 8, cx)),
        y: Math.max(radius + 8, Math.min(size - radius - 8, cy)),
        vx: (Math.random() - 0.5) * 80,
        vy: (Math.random() - 0.5) * 80,
        angle: Math.random() * Math.PI * 2,
        omega: (Math.random() - 0.5) * 6,
        radius,
        sides,
        displayValue: Math.floor(Math.random() * sides) + 1,
        targetValue: null,
        flipTimer: 0,
      })
    }
    return bodies
  }, [])

  // Sync dice count / sides when idle or settled
  useEffect(() => {
    const st = physicsRef.current
    st.sides = selectedSides
    if (st.phase === 'idle' || st.phase === 'settled') {
      const size = containerRef.current?.clientWidth || 320
      st.dice = buildDiceBodies(diceCount, selectedSides, size)
      for (const d of st.dice) {
        d.vx = 0
        d.vy = 0
        d.omega = 0
      }
    }
  }, [diceCount, selectedSides, buildDiceBodies])

  // Sync external hold-to-shake (e.g. holding down a d20 button)
  useEffect(() => {
    if (externalHolding && !holdingRef.current) {
      unlockHaptics()
      blurFocusedInputs()
      holdingRef.current = true
      const st = physicsRef.current
      const size = containerRef.current?.clientWidth || 320
      if (st.dice.length !== diceCount || st.sides !== selectedSides) {
        st.dice = buildDiceBodies(diceCount, selectedSides, size)
      }
      st.phase = 'shaking'
      st.collisions = 0
      setCollisionCount(0)
      setPhaseUI('shaking')
    } else if (!externalHolding && holdingRef.current) {
      holdingRef.current = false
      preservedFromShakeRef.current = true
      physicsRef.current.phase = 'rolling'
      physicsRef.current.rollElapsed = 0
      setPhaseUI('rolling')
    }
  }, [externalHolding, diceCount, selectedSides, buildDiceBodies])

  // Apply authoritative crypto/rand rolls when server broadcasts a DICE result
  useEffect(() => {
    if (!lastBroadcast || lastBroadcast.set_type !== 'DICE') return
    if (lastBroadcast.id === lastHandledID.current) return
    lastHandledID.current = lastBroadcast.id

    const detail = lastBroadcast.detail as DiceDetail
    if (!detail || !detail.rolls?.length) return

    const st = physicsRef.current
    const size = containerRef.current?.clientWidth || 320
    st.lastDetail = detail
    st.sides = detail.sides

    if (st.dice.length !== detail.rolls.length) {
      st.dice = buildDiceBodies(detail.rolls.length, detail.sides, size)
    }

    st.phase = 'rolling'
    st.rollElapsed = 0
    if (preservedFromShakeRef.current) {
      preservedFromShakeRef.current = false
    } else if (!holdingRef.current && !isPhoneShakingRef.current) {
      st.collisions = 0
      setCollisionCount(0)
    }
    setPhaseUI('rolling')

    st.dice.forEach((d, idx) => {
      d.sides = detail.sides
      d.targetValue = detail.rolls[idx] ?? detail.rolls[0]
      if (Math.hypot(d.vx, d.vy) < 180) {
        const ang = Math.random() * Math.PI * 2
        const spd = 340 + Math.random() * 240
        d.vx = Math.cos(ang) * spd
        d.vy = Math.sin(ang) * spd
        d.omega = (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 10)
      }
    })
  }, [lastBroadcast, buildDiceBodies])

  // 60 FPS Rigid-Body Collision, Haptic Feedback & Rendering Loop
  useEffect(() => {
    let rafId = 0
    let lastTime = performance.now()

    const step = (now: number) => {
      const dt = Math.min(0.032, Math.max(0.001, (now - lastTime) / 1000))
      lastTime = now

      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        const dpr = window.devicePixelRatio || 1
        const size = container.clientWidth
        if (size > 0 && (canvas.width !== Math.floor(size * dpr) || canvas.height !== Math.floor(size * dpr))) {
          canvas.width = Math.floor(size * dpr)
          canvas.height = Math.floor(size * dpr)
        }

        const st = physicsRef.current
        if (st.dice.length === 0 && size > 0) {
          st.dice = buildDiceBodies(diceCount, selectedSides, size)
          for (const d of st.dice) {
            d.vx = 0
            d.vy = 0
            d.omega = 0
          }
        }

        const isShaking = st.phase === 'shaking'
        const isRolling = st.phase === 'rolling'

        if (isShaking || isRolling) {
          if (isRolling) {
            st.rollElapsed += dt
          }

          const subSteps = 2
          const subDt = dt / subSteps

          for (let s = 0; s < subSteps; s++) {
            for (const d of st.dice) {
              if (isShaking) {
                const targetX = pointerPosRef.current ? pointerPosRef.current.x : size * 0.5
                const targetY = pointerPosRef.current ? pointerPosRef.current.y : size * 0.5
                const dx = targetX - d.x
                const dy = targetY - d.y
                const dist = Math.max(12, Math.hypot(dx, dy))
                const tx = -dy / dist
                const ty = dx / dist
                d.vx += (tx * 950 + (dx / dist) * 520 + (Math.random() - 0.5) * 1800) * subDt
                d.vy += (ty * 950 + (dy / dist) * 520 + (Math.random() - 0.5) * 1800) * subDt
                d.omega += (Math.random() - 0.5) * 35 * subDt

                const spd = Math.hypot(d.vx, d.vy)
                if (spd > 680) {
                  d.vx = (d.vx / spd) * 680
                  d.vy = (d.vy / spd) * 680
                }
                d.omega = Math.max(-18, Math.min(18, d.omega))
              } else if (isRolling) {
                const friction = Math.pow(0.24, subDt)
                d.vx *= friction
                d.vy *= friction
                d.omega *= Math.pow(0.22, subDt)
              }

              d.x += d.vx * subDt
              d.y += d.vy * subDt
              d.angle += d.omega * subDt

              const spd = Math.hypot(d.vx, d.vy)
              d.flipTimer += subDt * (2 + spd * 0.03)
              if (d.flipTimer >= 0.35 && (isShaking || spd > 42 || st.rollElapsed < 0.85)) {
                d.flipTimer = 0
                d.displayValue = Math.floor(Math.random() * d.sides) + 1
              } else if (isRolling && st.rollElapsed >= 0.95 && d.targetValue !== null) {
                d.displayValue = d.targetValue
              }

              // Wall collisions inside 1:1 tray + haptic bounce feedback
              const pad = 8
              const min = d.radius + pad
              const max = Math.max(min + 2, size - d.radius - pad)
              const wallRestitution = isShaking ? 0.88 : 0.74
              let hitWall = false
              let impactSpd = 0

              if (d.x < min) {
                impactSpd = Math.abs(d.vx)
                d.x = min
                d.vx = Math.abs(d.vx) * wallRestitution
                d.omega += (Math.random() - 0.5) * 6
                hitWall = true
              } else if (d.x > max) {
                impactSpd = Math.abs(d.vx)
                d.x = max
                d.vx = -Math.abs(d.vx) * wallRestitution
                d.omega += (Math.random() - 0.5) * 6
                hitWall = true
              }
              if (d.y < min) {
                impactSpd = Math.max(impactSpd, Math.abs(d.vy))
                d.y = min
                d.vy = Math.abs(d.vy) * wallRestitution
                d.omega += (Math.random() - 0.5) * 6
                hitWall = true
              } else if (d.y > max) {
                impactSpd = Math.max(impactSpd, Math.abs(d.vy))
                d.y = max
                d.vy = -Math.abs(d.vy) * wallRestitution
                d.omega += (Math.random() - 0.5) * 6
                hitWall = true
              }

              if (hitWall && s === 0 && impactSpd > 65) {
                triggerBounceHaptic('light')
              }
            }

            // Pairwise Elastic Die-to-Die Collisions + haptic pulse
            for (let i = 0; i < st.dice.length; i++) {
              for (let j = i + 1; j < st.dice.length; j++) {
                const a = st.dice[i]
                const b = st.dice[j]
                const dx = b.x - a.x
                const dy = b.y - a.y
                const dist = Math.hypot(dx, dy)
                const minDist = a.radius + b.radius + 2
                if (dist > 0.0001 && dist < minDist) {
                  const nx = dx / dist
                  const ny = dy / dist
                  const overlap = (minDist - dist) * 0.5
                  a.x -= nx * overlap
                  a.y -= ny * overlap
                  b.x += nx * overlap
                  b.y += ny * overlap

                  const rvx = b.vx - a.vx
                  const rvy = b.vy - a.vy
                  const velAlongNormal = rvx * nx + rvy * ny
                  if (velAlongNormal < 0) {
                    const restitution = isShaking ? 0.92 : 0.80
                    const impulse = (-(1 + restitution) * velAlongNormal) / 2
                    a.vx -= impulse * nx
                    a.vy -= impulse * ny
                    b.vx += impulse * nx
                    b.vy += impulse * ny

                    const tangentSpin = (rvx * -ny + rvy * nx) * 0.04
                    a.omega -= tangentSpin
                    b.omega += tangentSpin

                    if (s === 0 && Math.abs(velAlongNormal) > 45) {
                      st.collisions += 1
                      setCollisionCount(st.collisions)
                      triggerBounceHaptic('medium')
                      st.sparks.push({
                        x: (a.x + b.x) / 2,
                        y: (a.y + b.y) / 2,
                        r: 3,
                        maxR: 18,
                        alpha: 0.9,
                        color: '#fde68a',
                      })
                    }
                  }
                }
              }
            }
          }

          if (isRolling && st.rollElapsed > 1.05) {
            const maxSpeed = st.dice.reduce((acc, d) => Math.max(acc, Math.hypot(d.vx, d.vy)), 0)
            if (maxSpeed < 16 || st.rollElapsed > 2.4) {
              st.phase = 'settled'
              for (const d of st.dice) {
                d.vx = 0
                d.vy = 0
                d.omega = 0
                if (d.targetValue !== null) {
                  d.displayValue = d.targetValue
                }
              }
              setPhaseUI('settled')
              triggerBounceHaptic('heavy')
            }
          }
        }

        st.sparks = st.sparks.filter((sp) => {
          sp.r += (sp.maxR - sp.r) * dt * 10
          sp.alpha -= dt * 3.2
          return sp.alpha > 0.02
        })

        const ctx = canvas.getContext('2d')
        if (ctx && size > 0) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, size, size)

          const grad = ctx.createRadialGradient(size / 2, size / 2, 16, size / 2, size / 2, size * 0.72)
          grad.addColorStop(0, isShaking ? '#241447' : '#181030')
          grad.addColorStop(1, '#090712')
          ctx.fillStyle = grad
          ctx.fillRect(0, 0, size, size)

          ctx.strokeStyle = isShaking ? 'rgba(251, 191, 36, 0.75)' : 'rgba(139, 92, 246, 0.35)'
          ctx.lineWidth = isShaking ? 4 : 2
          ctx.strokeRect(6, 6, size - 12, size - 12)

          ctx.save()
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.12)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()

          for (const sp of st.sparks) {
            ctx.save()
            ctx.strokeStyle = sp.color
            ctx.globalAlpha = Math.max(0, sp.alpha)
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
          }

          for (const d of st.dice) {
            drawPolyhedralDie(ctx, d, st.phase === 'settled')
          }
        }
      }

      rafId = window.requestAnimationFrame(step)
    }

    rafId = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(rafId)
  }, [diceCount, selectedSides, buildDiceBodies])

  const beginHoldShake = (clientX?: number, clientY?: number) => {
    if (disabled) return
    triggerGestureHaptic('shake')
    blurFocusedInputs()
    holdingRef.current = true
    if (clientX !== undefined && clientY !== undefined && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      pointerPosRef.current = { x: clientX - rect.left, y: clientY - rect.top }
    } else {
      pointerPosRef.current = null
    }
    const st = physicsRef.current
    const size = containerRef.current?.clientWidth || 320
    if (st.dice.length !== diceCount || st.sides !== selectedSides) {
      st.dice = buildDiceBodies(diceCount, selectedSides, size)
    }
    st.phase = 'shaking'
    st.collisions = 0
    setCollisionCount(0)
    setPhaseUI('shaking')
  }

  const endHoldShake = () => {
    if (!holdingRef.current) return
    holdingRef.current = false
    pointerPosRef.current = null
    if (!disabled) {
      triggerGestureHaptic('throw')
      preservedFromShakeRef.current = true
      physicsRef.current.phase = 'rolling'
      physicsRef.current.rollElapsed = 0
      setPhaseUI('rolling')
      onRollCompleteRequest(selectedSides)
    } else {
      physicsRef.current.phase = 'idle'
      setPhaseUI('idle')
    }
  }

  const applyShakeImpulse = useCallback(
    (impulseX: number, impulseY: number) => {
      blurFocusedInputs()
      const st = physicsRef.current
      if (st.phase !== 'shaking') {
        const size = containerRef.current?.clientWidth || 320
        if (st.dice.length !== diceCount || st.sides !== selectedSides) {
          st.dice = buildDiceBodies(diceCount, selectedSides, size)
        }
        st.phase = 'shaking'
        st.collisions = 0
        setCollisionCount(0)
        setPhaseUI('shaking')
      }
      isPhoneShakingRef.current = true
      triggerBounceHaptic('light')

      for (const d of st.dice) {
        d.vx += impulseX * 42 + (Math.random() - 0.5) * 180
        d.vy += -impulseY * 42 + (Math.random() - 0.5) * 180
        d.omega += (Math.random() - 0.5) * 12
      }

      if (shakeStopTimerRef.current) {
        window.clearTimeout(shakeStopTimerRef.current)
      }
      shakeStopTimerRef.current = window.setTimeout(() => {
        if (isPhoneShakingRef.current) {
          isPhoneShakingRef.current = false
          if (!disabled) {
            preservedFromShakeRef.current = true
            physicsRef.current.phase = 'rolling'
            physicsRef.current.rollElapsed = 0
            setPhaseUI('rolling')
            onRollCompleteRequest(selectedSides)
          }
        }
      }, 450)
    },
    [diceCount, selectedSides, buildDiceBodies, disabled, onRollCompleteRequest]
  )

  // Fixed Accelerometer Shake Detector (null-safe ev.acceleration + gravity frame-delta + rotationRate)
  const handleMotionEvent = useCallback(
    (ev: DeviceMotionEvent) => {
      const hasLinear =
        ev.acceleration &&
        typeof ev.acceleration.x === 'number' &&
        typeof ev.acceleration.y === 'number'

      let deltaMag = 0
      let ix = 0
      let iy = 0

      if (hasLinear) {
        const ax = ev.acceleration!.x ?? 0
        const ay = ev.acceleration!.y ?? 0
        const az = ev.acceleration!.z ?? 0
        deltaMag = Math.hypot(ax, ay, az)
        ix = ax
        iy = ay
      } else if (
        ev.accelerationIncludingGravity &&
        typeof ev.accelerationIncludingGravity.x === 'number'
      ) {
        const gx = ev.accelerationIncludingGravity.x ?? 0
        const gy = ev.accelerationIncludingGravity.y ?? 0
        const gz = ev.accelerationIncludingGravity.z ?? 0
        if (lastGravRef.current) {
          const dx = gx - lastGravRef.current.x
          const dy = gy - lastGravRef.current.y
          const dz = gz - lastGravRef.current.z
          deltaMag = Math.hypot(dx, dy, dz)
          ix = dx
          iy = dy
        }
        lastGravRef.current = { x: gx, y: gy, z: gz }
      }

      // Check angular velocity (rotationRate) as well for wrist flicks
      const rot = ev.rotationRate
      const rotMag =
        rot && typeof rot.alpha === 'number'
          ? Math.hypot(rot.alpha ?? 0, rot.beta ?? 0, rot.gamma ?? 0)
          : 0

      const threshold = hasLinear ? 6.8 : 7.5
      if (deltaMag > threshold || rotMag > 230) {
        applyShakeImpulse(ix || (Math.random() - 0.5) * 10, iy || (Math.random() - 0.5) * 10)
      }
    },
    [applyShakeImpulse]
  )

  const handleOrientationEvent = useCallback(
    (ev: DeviceOrientationEvent) => {
      if (typeof ev.beta !== 'number' || typeof ev.gamma !== 'number') return
      if (lastOrientRef.current) {
        const dBeta = ev.beta - lastOrientRef.current.beta
        const dGamma = ev.gamma - lastOrientRef.current.gamma
        if (Math.hypot(dBeta, dGamma) > 28) {
          applyShakeImpulse(dGamma * 0.4, dBeta * 0.4)
        }
      }
      lastOrientRef.current = { beta: ev.beta, gamma: ev.gamma }
    },
    [applyShakeImpulse]
  )

  useEffect(() => {
    if (sensorStatus !== 'active') return
    window.addEventListener('devicemotion', handleMotionEvent)
    window.addEventListener('deviceorientation', handleOrientationEvent)
    return () => {
      window.removeEventListener('devicemotion', handleMotionEvent)
      window.removeEventListener('deviceorientation', handleOrientationEvent)
      if (shakeStopTimerRef.current) {
        window.clearTimeout(shakeStopTimerRef.current)
      }
    }
  }, [sensorStatus, handleMotionEvent, handleOrientationEvent])

  // Check secure context on mount
  const isLANPlainHTTP =
    typeof window !== 'undefined' &&
    !window.isSecureContext &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'

  const enableAccelerometer = async () => {
    unlockHaptics()
    blurFocusedInputs()
    setSensorNotice(null)

    if (sensorStatus === 'active') {
      setSensorStatus('off')
      return
    }

    // Modern iOS Safari, iOS Chrome, and Android Chrome strip DeviceMotionEvent unless in HTTPS Secure Context!
    if (isLANPlainHTTP) {
      setSensorStatus('needs_https')
      setSensorNotice(
        'Para habilitar el acelerómetro en iOS/Android es necesario abrir en HTTPS. Pulsa "Cambiar a HTTPS" abajo (acepta el certificado local en tu navegador).'
      )
      return
    }

    // Request iOS Motion & Orientation permissions synchronously in the tap gesture!
    const dmEvent = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> } }).DeviceMotionEvent
    const doEvent = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> } }).DeviceOrientationEvent

    if (dmEvent && typeof dmEvent.requestPermission === 'function') {
      try {
        const motionRes = await dmEvent.requestPermission()
        if (doEvent && typeof doEvent.requestPermission === 'function') {
          try {
            await doEvent.requestPermission()
          } catch {
            // Orientation permission optional if Motion was granted
          }
        }
        if (motionRes === 'granted') {
          setSensorStatus('active')
          setSensorNotice('¡Acelerómetro activo! Agita el móvil para batir y lanzar los dados.')
        } else {
          setSensorStatus('denied')
          setSensorNotice(
            'Permiso denegado en iOS. Cierra y reabre la pestaña en HTTPS, luego toca "Agitar Celular" y elige "Permitir".'
          )
        }
      } catch {
        setSensorStatus('denied')
        setSensorNotice(
          'El navegador iOS bloqueó la solicitud de movimiento. Asegúrate de abrir la app en HTTPS (no en modo privado restringido) o usa "Mantén para Batir".'
        )
      }
      return
    }

    if (!('DeviceMotionEvent' in window) && !('DeviceOrientationEvent' in window)) {
      setSensorStatus('unsupported')
      setSensorNotice('Este navegador/PC no tiene sensores de movimiento. Usa "Mantén para Batir".')
      return
    }

    setSensorStatus('active')
    setSensorNotice('¡Acelerómetro activo! Agita tu teléfono para batir y lanzar los dados.')
  }

  const switchToHTTPS = () => {
    const httpsURL = `https://${window.location.host}${window.location.pathname}${window.location.search}`
    window.location.href = httpsURL
  }

  return (
    <div className="space-y-2.5">
      {/* Strict 1:1 Aspect Ratio Square Physical Dice Arena */}
      <div
        ref={containerRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          beginHoldShake(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (!holdingRef.current || !containerRef.current) return
          triggerGestureHaptic('shake')
          const rect = containerRef.current.getBoundingClientRect()
          pointerPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        }}
        onPointerUp={endHoldShake}
        onPointerCancel={endHoldShake}
        className="relative aspect-square w-full max-w-[360px] mx-auto rounded-2xl overflow-hidden border border-violet-500/35 shadow-2xl shadow-violet-950/70 touch-none select-none cursor-grab active:cursor-grabbing"
      >
        <canvas ref={canvasRef} className="w-full h-full block" />

        <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between text-[11px] pointer-events-none">
          <span className="px-2 py-0.5 rounded-full bg-black/65 border border-violet-500/30 text-amber-200 font-mono">
            {diceCount}d{selectedSides}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-black/65 border border-violet-500/30 text-slate-300 font-mono">
            Choques: <strong className="text-amber-300">{collisionCount}</strong>
          </span>
        </div>

        <div className="absolute bottom-2.5 inset-x-3 text-center pointer-events-none">
          <span className="inline-block px-2.5 py-0.5 rounded-full bg-black/65 text-[10px] text-slate-300">
            {phaseUI === 'shaking'
              ? '¡Batiendo los dados! Suelta para lanzar'
              : phaseUI === 'rolling'
                ? 'Dados rodando y chocando...'
                : 'Mantén presionado el recuadro 1:1 para batir los dados'}
          </span>
        </div>
      </div>

      {/* Hold-to-Shake & Mobile Accelerometer Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2 max-w-[360px] mx-auto">
        <button
          type="button"
          disabled={disabled}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            beginHoldShake()
          }}
          onPointerUp={endHoldShake}
          onPointerCancel={endHoldShake}
          className={`flex-1 min-w-[165px] py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition touch-none select-none ${
            phaseUI === 'shaking'
              ? 'bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/40 scale-[0.98]'
              : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white'
          } disabled:opacity-45`}
        >
          <Hand className="w-4 h-4" />
          {phaseUI === 'shaking' ? 'Batiendo... ¡Suelta!' : 'Mantén para Batir Dados'}
        </button>

        <button
          type="button"
          onClick={enableAccelerometer}
          className={`py-2.5 px-3 rounded-xl font-semibold text-xs flex items-center gap-1.5 border transition ${
            sensorStatus === 'active'
              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
              : 'bg-[#090712] border-violet-500/30 text-slate-300 hover:border-amber-400/50'
          }`}
          title="Activar detección de agitar el celular"
        >
          <Smartphone className="w-4 h-4" />
          {sensorStatus === 'active' ? 'Agitar Activo' : 'Agitar Celular'}
        </button>
      </div>

      {!supportsHardwareVibration() && (
        <div className="max-w-[360px] mx-auto text-[10px] text-slate-400 text-center">
          iOS usa Taptic Engine nativo al tocar/batir (el vibrador continuo Web Vibration API solo está disponible en Android).
        </div>
      )}

      {(isLANPlainHTTP || sensorStatus === 'needs_https') && (
        <div className="max-w-[360px] mx-auto rounded-xl bg-violet-950/50 border border-violet-400/40 px-3 py-2 text-[11px] text-violet-200 flex items-center justify-between gap-2">
          <span>Acelerómetro iOS/Android requiere HTTPS en LAN.</span>
          <button
            type="button"
            onClick={switchToHTTPS}
            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shrink-0 flex items-center gap-1"
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Cambiar a HTTPS
          </button>
        </div>
      )}

      {sensorNotice && (
        <div className="max-w-[360px] mx-auto text-[11px] text-amber-200/90 bg-amber-950/40 border border-amber-500/30 rounded-xl px-3 py-2 flex items-start gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span>{sensorNotice}</span>
        </div>
      )}
    </div>
  )
}

function drawPolyhedralDie(ctx: CanvasRenderingContext2D, d: DieBody, settled: boolean) {
  ctx.save()
  ctx.translate(d.x, d.y)

  ctx.save()
  ctx.translate(3, 5)
  ctx.rotate(d.angle)
  drawDiePolygonPath(ctx, d.sides, d.radius)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.fill()
  ctx.restore()

  ctx.rotate(d.angle)
  drawDiePolygonPath(ctx, d.sides, d.radius)

  const isCrit = settled && d.sides === 20 && d.displayValue === 20
  const isFumble = settled && d.sides === 20 && d.displayValue === 1

  const grad = ctx.createLinearGradient(-d.radius, -d.radius, d.radius, d.radius)
  if (isCrit) {
    grad.addColorStop(0, '#10b981')
    grad.addColorStop(1, '#065f46')
  } else if (isFumble) {
    grad.addColorStop(0, '#e11d48')
    grad.addColorStop(1, '#881337')
  } else {
    grad.addColorStop(0, '#6d28d9')
    grad.addColorStop(1, '#2e1065')
  }
  ctx.fillStyle = grad
  ctx.fill()

  ctx.strokeStyle = isCrit ? '#a7f3d0' : isFumble ? '#fda4af' : '#fbbf24'
  ctx.lineWidth = settled ? 2.2 : 1.6
  ctx.stroke()

  drawInnerFacetLines(ctx, d.sides, d.radius)

  ctx.fillStyle = isCrit || isFumble ? '#ffffff' : '#fef3c7'
  ctx.font = `800 ${Math.max(10, Math.round(d.radius * 0.72))}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(d.displayValue), 0, 1)

  ctx.restore()
}

function drawDiePolygonPath(ctx: CanvasRenderingContext2D, sides: number, r: number) {
  ctx.beginPath()
  if (sides === 2) {
    ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2)
  } else if (sides === 4) {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  } else if (sides === 6) {
    const s = r * 0.85
    ctx.roundRect(-s, -s, s * 2, s * 2, 5)
  } else if (sides === 8 || sides === 10 || sides === 100) {
    ctx.moveTo(0, -r)
    ctx.lineTo(r * 0.9, 0)
    ctx.lineTo(0, r)
    ctx.lineTo(-r * 0.9, 0)
    ctx.closePath()
  } else if (sides === 12) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  } else {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 6
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
}

function drawInnerFacetLines(ctx: CanvasRenderingContext2D, sides: number, r: number) {
  ctx.save()
  ctx.strokeStyle = 'rgba(253, 230, 138, 0.28)'
  ctx.lineWidth = 1
  if (sides === 20) {
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 4) / 6
      const x = Math.cos(a) * (r * 0.58)
      const y = Math.sin(a) * (r * 0.58)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  } else if (sides === 12) {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
      const x = Math.cos(a) * (r * 0.55)
      const y = Math.sin(a) * (r * 0.55)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  } else if (sides === 8 || sides === 10 || sides === 100) {
    ctx.beginPath()
    ctx.moveTo(-r * 0.9, 0)
    ctx.lineTo(r * 0.9, 0)
    ctx.stroke()
  }
  ctx.restore()
}
