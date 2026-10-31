let audioContext

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) return null
  audioContext ||= new AudioContextCtor()
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {})
  return audioContext
}

function tone(frequency, startAt, duration, type = 'sine', volume = 0.045) {
  const ctx = getAudioContext()
  if (!ctx) return
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, startAt)
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + duration + 0.02)
}

export function playSuccessSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  const now = ctx.currentTime
  tone(660, now, 0.12, 'sine', 0.04)
  tone(880, now + 0.09, 0.16, 'sine', 0.045)
}

export function playFailureSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  const now = ctx.currentTime
  tone(260, now, 0.16, 'triangle', 0.04)
  tone(190, now + 0.11, 0.2, 'triangle', 0.035)
}

export function playInfoSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  tone(520, ctx.currentTime, 0.12, 'sine', 0.03)
}
