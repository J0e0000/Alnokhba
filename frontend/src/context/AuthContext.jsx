import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { initUndoManager, resetUndoManager } from '../lib/undoManager'
import { clearQueue } from '../lib/offlineQueue'

const AuthContext = createContext(null)
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000 // 30 دقيقة

// ── Network-resilient profile loading ──────────────────────────────────────
// WHY THIS EXISTS — the "تعذر الاتصال" hard-stuck screen (fixed):
// the profile query used to be a single un-retried round-trip; one hiccup
// (flaky mobile data, phone waking from sleep with a dead socket, Supabase
// cold start) left `session && !profile` → the network status screen with no
// way out but a manual reload. Now every critical query gets a per-attempt
// timeout (hung fetches on mobile networks) + bounded backoff retries for
// transport-level failures only.

const RETRYABLE_MSG = /failed to fetch|fetch failed|networkerror|network error|load failed|timed?\s?out|timeout|aborted?|err_name_not_resolved|err_internet_disconnected|err_connection/i

// Transport failures are retryable; PostgREST/RLS problems (machine codes
// like PGRST*, 42501…) are NOT — retrying those just burns time.
function isRetryableQueryError(error) {
  if (!error) return true
  if (String(error.code || '').startsWith('PGRST')) return false
  if (!error.code) return true // bare fetch/timeout rejection = transport
  return RETRYABLE_MSG.test(`${error.message || ''} ${error.details || ''}`)
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function fetchWithRetry(run, { attempts = 3, timeoutMs = 12000, baseMs = 700 } = {}) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('network timeout')), timeoutMs)
        Promise.resolve(run()).then(
          (v) => { clearTimeout(timer); resolve(v) },
          (e) => { clearTimeout(timer); reject(e) },
        )
      })
    } catch (err) {
      lastError = err
      if (i === attempts - 1 || !isRetryableQueryError(err)) break
      await delay(baseMs * 2 ** i + Math.random() * 300)
    }
  }
  throw lastError
}

const PROFILE_FETCH_OPTS = { attempts: 3, timeoutMs: 12000, baseMs: 700 }
const RPC_FETCH_OPTS = { attempts: 3, timeoutMs: 12000, baseMs: 700 }

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [ownerProfile, setOwnerProfile] = useState(null) // لو الحساب الحالي مساعد، ده بروفايل صاحب البيانات
  // جلسة "وصول الدعم" النشطة لو الأدمن فاتح حساب مستخدم لفحصه — تتحمل من my_support_session
  // (graceful: لو الـ RPC مش منشّر بعد بعد migration 036 بترجع null وكل حاجة شغالة عادي)
  const [supportSession, setSupportSession] = useState(null)
  const [unlockedFeatures, setUnlockedFeatures] = useState(new Set())
  const [loading, setLoading] = useState(true)
  // صحيح لو فشل تحميل البروفايل نهائيًا بعد كل المحاولات — بيفعّل حلقة الإصلاح الذاتي تحت
  const [profileError, setProfileError] = useState(false)

  // تسجيل خروج تلقائي بعد فترة عدم نشاط طويلة، لحماية الحساب لو الجهاز اتسيب مفتوح
  useEffect(() => {
    if (!session) return
    let timer
    const resetTimer = () => {
      clearTimeout(timer)
      timer = setTimeout(() => supabase.auth.signOut(), INACTIVITY_LIMIT_MS)
    }
    const events = ['mousemove', 'keydown', 'touchstart', 'click']
    events.forEach((e) => window.addEventListener(e, resetTimer))
    resetTimer()
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, resetTimer)) }
  }, [session])
  const [passwordRecovery, setPasswordRecovery] = useState(() => {
    const query = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return query.get('auth') === 'recovery' || hash.get('type') === 'recovery' || Boolean(hash.get('access_token'))
  })

  // Gate-critical profile read + post-profile lookups. RESILIENCE CONTRACT:
  //   1) the profile read retries (timeout + backoff) on transport failures —
  //      one hiccup no longer strands the teacher on the error screen;
  //   2) failures in LATER legs (owner binding / support / unlocks) degrade in
  //      place and NEVER null an already-loaded profile (the old code threw
  //      past `setProfile(data)` and the boot handler nulled it → bogus
  //      "تعذر الاتصال" even though the profile had loaded fine).
  const loadAll = useCallback(async (userId) => {
    let data
    try {
      data = await fetchWithRetry(async () => {
        const res = await supabase.from('profiles').select('*').eq('id', userId).single()
        if (res.error) {
          const e = new Error(res.error.message || 'profile query failed')
          e.code = res.error.code
          e.details = res.error.details
          throw e
        }
        return res.data
      }, PROFILE_FETCH_OPTS)
    } catch (loadError) {
      console.error('Failed to load profile:', loadError?.message)
      setProfile(null)
      setOwnerProfile(null)
      setProfileError(true)
      throw loadError
    }
    setProfile(data)
    setProfileError(false)

    // Independent post-profile lookups in one parallel batch:
    // (a) is this account an assistant bound to another teacher's workspace?
    // (b) is there an active support-access session? (admin inspecting a user)
    // Best-effort: a transport failure here degrades to "standalone teacher"
    // for this pass instead of wiping the loaded profile.
    const [ownerRes, supportRes] = await Promise.all([
      fetchWithRetry(() => supabase.rpc('my_workspace_owner'), RPC_FETCH_OPTS).catch(() => null),
      // migration 036 not applied yet → RPC missing → result carries .error → data null. Normal behavior.
      fetchWithRetry(() => supabase.rpc('my_support_session'), { attempts: 2, timeoutMs: 12000, baseMs: 700 }).catch(() => null),
    ])
    setSupportSession(supportRes?.data ?? null)
    const ownerId = ownerRes?.data ?? null

    if (ownerId) {
      // Owner profile + feature unlocks are independent of each other.
      const [ownerProfileRes, unlocksRes] = await Promise.all([
        fetchWithRetry(() => supabase.from('profiles').select('*').eq('id', ownerId).single(), RPC_FETCH_OPTS)
          .then((r) => (r?.error ? { data: null } : r))
          .catch(() => ({ data: null })),
        fetchWithRetry(() => supabase.from('feature_unlocks').select('feature_key, unlocked').eq('teacher_id', ownerId), RPC_FETCH_OPTS).catch(() => null),
      ])
      setOwnerProfile(ownerProfileRes?.data ?? null)
      setUnlockedFeatures(new Set((unlocksRes?.data ?? []).filter((u) => u.unlocked).map((u) => u.feature_key)))
    } else {
      setOwnerProfile(null)
      const unlocksRes = await fetchWithRetry(
        () => supabase.from('feature_unlocks').select('feature_key, unlocked').eq('teacher_id', userId),
        RPC_FETCH_OPTS,
      ).catch(() => null)
      setUnlockedFeatures(new Set((unlocksRes?.data ?? []).filter((u) => u.unlocked).map((u) => u.feature_key)))
    }
  }, [])

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!mounted) return
      if (error) console.error('Failed to restore Supabase session:', error.message)
      setSession(session)
      if (session?.user) {
        // Initialize the undo manager scope for this user — critical for
        // data isolation: without this, two teachers using the same browser
        // would see each other's undo history (undoManager uses localStorage
        // keys that are NOT scoped per user by default).
        initUndoManager(session.user.id)
        try { await loadAll(session.user.id) } catch (loadError) {
          console.error('Failed to load account profile:', loadError)
          if (mounted) setProfile(null)
        }
      }
      if (mounted) setLoading(false)
    }).catch((error) => {
      console.error('Supabase session initialization failed:', error)
      if (mounted) { setSession(null); setProfile(null); setLoading(false) }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      // PERF (performance round): the listener used to re-run the FULL
      // profile chain on EVERY auth event. Two concrete costs:
      //  1) at boot, supabase-js emits INITIAL_SESSION right after our own
      //     getSession() already loaded everything → the whole chain ran TWICE;
      //  2) every hourly TOKEN_REFRESHED re-ran the chain AND flipped the
      //     full-screen loading gate on top of the teacher's work.
      // Profile/subscription data does NOT change when a JWT is refreshed,
      // so only real sign-ins need a reload. Boot is covered by getSession().
      if (event === 'SIGNED_IN' && session?.user) {
        setLoading(true)
        initUndoManager(session.user.id)
        loadAll(session.user.id).catch(() => { /* profileError set inside loadAll; self-heal loop takes over */ }).finally(() => setLoading(false))
      } else if (!session) {
        // Sign-out (manual, inactivity, or session-expired):
        // Clear per-user local state to prevent the next logged-in user
        // (on this same browser) from seeing the previous user's undo
        // history, offline queue, or dismissed broadcasts.
        resetUndoManager()
        clearQueue().catch(() => { /* ignore — best-effort */ })
        setProfile(null)
        setOwnerProfile(null)
        setSupportSession(null)
        setUnlockedFeatures(new Set())
        setLoading(false)
      }
    })

    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  // ── Self-healing profile gate ──────────────────────────────────────────
  // While the "تعذر الاتصال" gate is visible (session restored but profile
  // missing), keep retrying in the background with capped backoff — and
  // retry IMMEDIATELY when connectivity returns (online event) or the user
  // comes back to the tab (wake from sleep is the #1 trigger of the old
  // hard-stuck screen). When the profile finally loads, the Gate re-renders
  // straight into the app with no manual reload.
  useEffect(() => {
    const uid = session?.user?.id
    if (!uid || !profileError || profile || loading) return
    let cancelled = false
    let timer = null
    let inFlight = false
    const delays = [3000, 6000, 10000, 15000]
    let step = 0
    const attempt = async () => {
      if (inFlight) return false
      inFlight = true
      try { await loadAll(uid); return true } catch { return false } finally { inFlight = false }
    }
    const loop = () => {
      timer = setTimeout(async () => {
        if (cancelled) return
        const ok = await attempt()
        if (cancelled) return
        if (!ok) step = Math.min(step + 1, delays.length - 1)
        else step = 0
        loop()
      }, delays[step])
    }
    const immediate = () => {
      if (cancelled) return
      clearTimeout(timer)
      step = 0
      attempt().then((ok) => {
        if (cancelled) return
        if (!ok) loop() // if ok → profileError flips → this effect cleans itself up
      })
    }
    const onOnline = () => immediate()
    const onVisible = () => { if (document.visibilityState === 'visible') immediate() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    loop()
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session?.user?.id, profileError, profile, loading, loadAll])

  const signUp = async ({ email, password, fullName, phone }) => {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone: phone } },
    })
  }

  const signIn = async ({ email, password }) => {
    return supabase.auth.signInWithPassword({ email, password })
  }

  const signOut = async () => {
    // لو في جلسة وصول دعم نشطة، أقفلها الأول (بعد كده مش هنقدر نستدعي RPC بدون جلسة)
    try {
      if (supportSession) await supabase.rpc('admin_end_support_session', { p_reason: 'signout' })
    } catch { /* best-effort — ستُغلق تلقائياً عند انتهاء صلاحيتها */ }
    // Clear local per-user state BEFORE the actual signOut RPC — that way
    // even if the network call fails, this browser no longer leaks the
    // previous teacher's undo history or offline queue to whoever signs
    // in next.
    try {
      resetUndoManager()
      await clearQueue()
      // Best-effort: clear other per-user localStorage keys that could leak
      // data across accounts on shared devices.
      try {
        localStorage.removeItem('dismissedBroadcasts')
        localStorage.removeItem('assistant_request_sent')
      } catch { /* ignore */ }
    } catch (e) {
      console.warn('signOut: failed to clear local state:', e)
    }
    return supabase.auth.signOut()
  }

  const refreshProfile = async () => {
    if (session?.user) await loadAll(session.user.id)
  }

  // Manual in-place retry for the gate screen button — NO full page reload
  // (keeps the browser alive, works even when a reload would hit the same
  // flaky state). Failure is safe: profileError stays and the self-heal
  // loop keeps running in the background.
  const retryProfile = useCallback(async () => {
    const uid = session?.user?.id
    if (!uid || loading) return
    try { await loadAll(uid) } catch { /* handled: error state persists, loop continues */ }
  }, [session, loading, loadAll])

  const setNewPassword = async (password) => {
    const res = await supabase.auth.updateUser({ password })
    if (!res.error) setPasswordRecovery(false)
    return res
  }

  // لو الحساب ده مساعد عند حد، الاشتراك بتاعه بيتحدد باشتراك صاحب البيانات مش اشتراكه هو،
  // وكل الكتابة/القراءة في البيانات بتتم باسم صاحب البيانات (effectiveTeacherId)
  const isAssistant = Boolean(ownerProfile)
  const effectiveTeacherId = ownerProfile?.id || profile?.id || null
  const subscriptionSourceProfile = ownerProfile || profile

  const isSubscriptionActive = Boolean(
    subscriptionSourceProfile &&
    subscriptionSourceProfile.is_verified && // الحساب لازم يكون متفعل من الأدمن
    ['trial', 'active'].includes(subscriptionSourceProfile.subscription_status) &&
    new Date(subscriptionSourceProfile.subscription_expires_at) > new Date()
  )

  // PERF (performance round): the provider value used to be a fresh object
  // literal on every render, so ANY AuthProvider state change re-rendered
  // every useAuth() consumer in the app. Memoized now.
  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    ownerProfile,
    isAssistant,
    effectiveTeacherId,
    supportSession,
    loading,
    isSubscriptionActive,
    unlockedFeatures,
    passwordRecovery,
    setNewPassword,
    signUp,
    signIn,
    signOut,
    refreshProfile,
    retryProfile,
    profileError,
  }), [session, profile, ownerProfile, isAssistant, effectiveTeacherId, supportSession, loading, isSubscriptionActive, unlockedFeatures, passwordRecovery, retryProfile, profileError])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
