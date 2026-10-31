import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const { effectiveTeacherId } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!effectiveTeacherId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('teacher_settings')
      .select('*')
      .eq('teacher_id', effectiveTeacherId)
      .single()
    if (!error) setSettings(data)
    setLoading(false)
  }, [effectiveTeacherId])

  useEffect(() => { load() }, [load])

  const updateSettings = async (patch) => {
    const { data, error } = await supabase
      .from('teacher_settings')
      .update(patch)
      .eq('teacher_id', effectiveTeacherId)
      .select()
      .single()
    if (!error) setSettings(data)
    return { data, error }
  }

  const value = useMemo(() => ({ settings, loading, updateSettings, refresh: load }), [settings, loading, updateSettings, load])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
