// Cross-platform tactile & hardware vibration engine for Rollhaven:
// 1. Android / Chromium Vibration API (`navigator.vibrate`) with motor spin-up safe durations (>= 48ms)
//    and non-cancelling lock window so rapid collisions don't cancel in-flight pulses.
// 2. iOS Safari 17.4+ native Taptic Engine (`<input type="checkbox" switch />` clicked synchronously
//    during user gestures and within active interaction windows, without `pointer-events: none`).
// 3. Subtle low-frequency WebAudio sub-bass thud unlocked on user gesture.

let audioCtx: AudioContext | null = null
let lastVibrateAt = 0
let lastIOSTapticAt = 0
let iosLabelEl: HTMLLabelElement | null = null

function ensureIOSSwitchHook(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null
  if (iosLabelEl && document.body.contains(iosLabelEl)) return iosLabelEl
  try {
    const wrap = document.createElement('div')
    // Must stay technically visible/interactive (no display:none, no pointer-events:none)
    // so iOS WebKit fires the native Taptic Engine when label.click() is invoked.
    wrap.style.cssText =
      'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;overflow:hidden;z-index:-1;'
    wrap.setAttribute('aria-hidden', 'true')

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.id = 'rollhaven-ios-haptic-switch'
    input.setAttribute('switch', '')
    input.tabIndex = -1

    const label = document.createElement('label')
    label.htmlFor = input.id
    label.textContent = 'h'

    wrap.appendChild(input)
    wrap.appendChild(label)
    document.body.appendChild(wrap)
    iosLabelEl = label
    return label
  } catch {
    return null
  }
}

export function supportsHardwareVibration(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

export function unlockHaptics(): void {
  ensureIOSSwitchHook()
  if (typeof window === 'undefined') return
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctx) {
      if (!audioCtx) {
        audioCtx = new Ctx()
      }
      if (audioCtx.state === 'suspended') {
        void audioCtx.resume()
      }
    }
  } catch {
    // AudioContext optional
  }
}

// Synchronous gesture-scoped haptic: call directly inside pointerdown/pointermove/pointerup/click
// so iOS Safari Taptic switch & Android Chromium user-activation vibration fire reliably.
export function triggerGestureHaptic(pattern: 'tap' | 'shake' | 'throw' = 'tap'): void {
  unlockHaptics()
  const now = performance.now()

  if (pattern === 'shake' && now - lastIOSTapticAt < 95) {
    return
  }
  lastIOSTapticAt = now

  try {
    const lbl = ensureIOSSwitchHook()
    lbl?.click()
  } catch {
    // Ignore iOS switch fallback errors
  }

  try {
    if (supportsHardwareVibration()) {
      if (pattern === 'throw') {
        lastVibrateAt = now + 260
        navigator.vibrate([55, 65, 50, 75, 45])
      } else if (pattern === 'shake') {
        if (now >= lastVibrateAt) {
          lastVibrateAt = now + 95
          navigator.vibrate(48)
        }
      } else {
        if (now >= lastVibrateAt) {
          lastVibrateAt = now + 70
          navigator.vibrate(40)
        }
      }
    }
  } catch {
    // Ignore vibrate errors
  }
}

function playTactileThud(intensity: 'light' | 'medium' | 'heavy'): void {
  if (!audioCtx || audioCtx.state !== 'running') return
  try {
    const now = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()

    osc.type = 'triangle'
    const startFreq = intensity === 'heavy' ? 115 : intensity === 'medium' ? 88 : 68
    const endFreq = intensity === 'heavy' ? 42 : 34
    const dur = intensity === 'heavy' ? 0.048 : intensity === 'medium' ? 0.028 : 0.018
    const peakGain = intensity === 'heavy' ? 0.24 : intensity === 'medium' ? 0.16 : 0.09

    osc.frequency.setValueAtTime(startFreq, now)
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + dur)

    gain.gain.setValueAtTime(peakGain, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur)

    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(now)
    osc.stop(now + dur + 0.005)
  } catch {
    // Ignore audio errors
  }
}

export function triggerBounceHaptic(intensity: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (typeof window === 'undefined') return

  const now = performance.now()

  // 1. Android / Chromium Vibration API with spin-up safe duration & non-cancelling window
  try {
    if (supportsHardwareVibration()) {
      if (intensity === 'heavy') {
        lastVibrateAt = now + 220
        navigator.vibrate([65, 50, 90])
      } else if (now >= lastVibrateAt) {
        if (intensity === 'medium') {
          lastVibrateAt = now + 105
          navigator.vibrate(68)
        } else {
          lastVibrateAt = now + 95
          navigator.vibrate(48)
        }
      }
    }
  } catch {
    // Ignore vibrate errors
  }

  // 2. iOS Safari 17.4+ native Taptic Engine switch toggle
  try {
    if (now - lastIOSTapticAt >= (intensity === 'heavy' ? 30 : 85)) {
      lastIOSTapticAt = now
      const lbl = ensureIOSSwitchHook()
      lbl?.click()
    }
  } catch {
    // Ignore iOS switch errors
  }

  // 3. Low-frequency tactile thud
  playTactileThud(intensity)
}
