import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  // NOKHBA uses one visual theme. Migrate any old dark preference to light.
  const [isLight, setIsLight] = useState(true)

  useEffect(() => {
    setIsLight(true)
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }, [])

  const toggleTheme = () => {
    // Kept for compatibility with existing components; the product remains one-theme.
    setIsLight(true)
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }

  return (
    <ThemeContext.Provider value={{ isLight, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
