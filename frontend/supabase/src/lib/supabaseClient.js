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
