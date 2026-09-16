/**
 * ZakiWidget.jsx — واجهة زكي 🤖
 * ============================================================================
 * Floating mascot bubble that reacts to app events via zakiEngine.
 * Uses emoji avatars (no sprite PNGs needed).
 *
 * USAGE in Dashboard.jsx:
 *   import ZakiWidget from '../components/ZakiWidget'
 *   import { zaki } from '../lib/zakiEngine'
 *
 *   // Render once at the bottom of your JSX:
 *   <ZakiWidget autoStartTutorialForNewUsers />
 * ============================================================================
 */
import { useEffect, useState } from 'react'
import { zaki } from '../lib/zakiEngine'
import { useLanguage } from '../context/LanguageContext'

// Emoji fallback per mood
const MOOD_EMOJIS = {
  idle: '😊',
  thinking: '🤔',
  explaining: '💬',
  happy: '😄',
  celebrating: '🎉',
  warning: '⚠️',
}

export default function ZakiWidget({ autoStartTutorialForNewUsers = false }) {
  const { isArabic } = useLanguage()
  const [state, setState] = useState(zaki.getState())
  const [tutorialStep, setTutorialStep] = useState(null)
  const [bouncing, setBouncing] = useState(false)

  useEffect(() => {
    zaki.setLang(isArabic ? 'ar' : 'en')
  }, [isArabic])

  useEffect(() => {
    const off = zaki.on('change', (s) => {
      setState(s)
      if (s.mood !== state.mood) {
        setBouncing(true)
        setTimeout(() => setBouncing(false), 400)
      }
    })
    const offStep = zaki.on('tutorial:step', ({ index, step }) => setTutorialStep({ index, step }))
    const offEnd = zaki.on('tutorial:end', () => setTutorialStep(null))

    const ping = () => zaki.ping()
    window.addEventListener('click', ping)
    window.addEventListener('keydown', ping)

    if (autoStartTutorialForNewUsers) {
      const seen = localStorage.getItem('zaki_tutorial_seen')
      if (!seen) {
        setTimeout(() => zaki.startTutorial(), 1500)
        localStorage.setItem('zaki_tutorial_seen', '1')
      }
    }

    return () => {
      off()
      offStep()
      offEnd()
      window.removeEventListener('click', ping)
      window.removeEventListener('keydown', ping)
    }
  }, [autoStartTutorialForNewUsers, isArabic])

  if (!state.visible) return null

  const emoji = MOOD_EMOJIS[state.mood] || MOOD_EMOJIS.idle
  const steps = zaki.getTutorialSteps()

  return (
    <>
      {/* Tutorial top bar */}
      {tutorialStep && (
        <div className="fixed top-0 inset-x-0 z-[999] flex justify-center pt-4">
          <div className="flex items-center gap-3 bg-[#0E2954] rounded-full px-4 py-2 shadow-xl">
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all ${i === tutorialStep.index ? 'bg-[#FFD700] scale-125' : 'bg-white/30'}`}
                />
              ))}
            </div>
            <span className="text-white/50 text-[11px] font-bold">
              {isArabic ? `خطوة ${tutorialStep.index + 1}/${steps.length}` : `Step ${tutorialStep.index + 1}/${steps.length}`}
            </span>
            <button
              onClick={() => zaki.skipTutorial()}
              className="text-white/40 hover:text-white text-xs font-bold transition-colors"
            >
              {isArabic ? 'تخطي ✕' : 'Skip ✕'}
            </button>
          </div>
        </div>
      )}

      {/* Floating Zaki bubble */}
      <div className="fixed bottom-5 right-5 z-[900] flex flex-col items-end gap-2.5">
        {/* Speech bubble */}
        {state.message && (
          <div className="max-w-[260px] bg-white text-[#0E2954] rounded-2xl px-4 py-3 shadow-xl relative animate-in fade-in slide-in-from-bottom-3"
            style={{ direction: isArabic ? 'rtl' : 'ltr', fontFamily: "'Cairo', sans-serif" }}
          >
            <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white rotate-45 shadow-sm" />
            <p className="text-[13.5px] font-semibold leading-relaxed m-0 relative z-10">{state.message}</p>

            {/* Tutorial nav buttons */}
            {tutorialStep && (
              <div className="flex gap-2 mt-3 justify-end">
                {tutorialStep.index > 0 && (
                  <button
                    onClick={() => zaki.prevTutorialStep()}
                    className="text-[#0E2954] border border-[#0E2954] rounded-xl px-3.5 py-1.5 text-xs font-bold hover:bg-gray-100 transition-colors"
                    style={{ fontFamily: "'Cairo', sans-serif" }}
                  >
                    {isArabic ? 'السابق' : 'Prev'}
                  </button>
                )}
                <button
                  onClick={() => zaki.nextTutorialStep()}
                  className="bg-[#FFD700] text-[#0E2954] rounded-xl px-3.5 py-1.5 text-xs font-extrabold hover:bg-yellow-400 transition-colors"
                  style={{ fontFamily: "'Cairo', sans-serif" }}
                >
                  {tutorialStep.index >= steps.length - 1
                    ? (isArabic ? 'تمام، خلصنا 🎉' : 'Done! 🎉')
                    : (isArabic ? 'التالي' : 'Next')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Avatar button */}
        <button
          onClick={() => { if (!tutorialStep) zaki.startTutorial() }}
          className={`relative w-16 h-16 rounded-full border-2 border-[#FFD700] bg-[#0E2954] shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center ${bouncing ? 'animate-bounce' : ''}`}
          title={isArabic ? 'زكي — اضغط لبدء جولة تعريفية' : 'Zaki — click to start tour'}
        >
          <span className="text-3xl select-none">{emoji}</span>
          <span className="absolute -top-2 -right-1 text-base select-none">🎓</span>
          {!state.message && !tutorialStep && (
            <span className="absolute inset-0 rounded-full border-2 border-[#FFD700]/50 animate-ping" />
          )}
        </button>
      </div>
    </>
  )
}
