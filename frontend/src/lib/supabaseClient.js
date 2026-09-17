import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing Supabase env vars. Create a .env file based on .env.example ' +
    'with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

// ملاحظة أمان: الـ anon key ده آمن يظهر في كود الواجهة — مش سر.
// الحماية الحقيقية موجودة في قواعد Row Level Security على السيرفر (schema.sql)،
// مش في إخفاء المفتاح ده.
export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.invalid', 'placeholder-key')

// Bridge: expose the backend URL to the index.html diagnostics engine so the
// crash report can show backend reachability (see window.__NOKHBA_DIAG).
try {
  if (supabaseUrl && typeof window !== 'undefined') window.__NOKHBA_SUPABASE_URL__ = supabaseUrl
} catch { /* engine optional */ }
