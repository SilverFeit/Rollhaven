// Cross-platform tactile/haptic feedback helper for Rollhaven:
// 1. Android / Web Vibration API (`navigator.vibrate`)
// 2. iOS Safari 17.4+ native Taptic Engine (`<input type="checkbox" switch />` via label click)
// 3. Subtle low-frequency WebAudio sub-bass thud unlocked on user gesture so every device gets tactile feedback

let audioCtx: AudioContext | null = null
let lastLightAt = 0
let lastMediumAt = 0
let iosLabelEl: HTMLLabelElement | null = null

function ensureIOSSwitchHook() {
  if (typeof document === 'undefined' || iosLabelEl) return
  try {
    const wrap = document.createElement('div')
    wrap.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;'
    wrap.setAttribute('aria-hidden', 'true')

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.id = 'rollhaven-ios-haptic-switch'
    input.setAttribute('switch', '')

    const label = document.createElement('label')
    label.htmlFor = input.id
    label.textContent = 'haptic'

    wrap.appendChild(input)
    wrap.appendChild(label)
    document.body.appendChild(wrap)
    iosLabelEl = label
  } catch {
    // Ignore if DOM isn't ready
  }
}

export function unlockHaptics(): void {
  ensureIOSSwitchHook()
  if (typeof window === 'undefined') return
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    if (!audioCtx) {
      audioCtx = new Ctx()
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }
  } catch {
    // AudioContext optional
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
  if (intensity === 'light') {
    if (now - lastLightAt < 45) return
    lastLightAt = now
  } else if (intensity === 'medium') {
    if (now - lastMediumAt < 34) return
    lastMediumAt = now
  }

  // 1. Android / Chromium Vibration API
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      if (intensity === 'heavy') {
        navigator.vibrate([28, 30, 52])
      } else if (intensity === 'medium') {
        navigator.vibrate(24)
      } else {
        navigator.vibrate(14)
      }
    }
  } catch {
    // Ignore vibrate errors
  }

  // 2. iOS Safari 17.4+ native Taptic Engine switch toggle
  try {
    ensureIOSSwitchHook()
    if (iosLabelEl && (intensity === 'medium' || intensity === 'heavy')) {
      iosLabelEl.click()
    }
  } catch {
    // Ignore iOS switch errors
  }

  // 3. Low-frequency tactile thud
  playTactileThud(intensity)
}
