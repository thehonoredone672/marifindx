import { create } from 'zustand'

const STORAGE_KEY = 'marifindx-theme'

/** Saved choice wins; otherwise follow the OS. */
function resolveInitialTheme() {
  if (typeof window === 'undefined') return false
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark') return true
    if (saved === 'light') return false
  } catch {
    /* private mode / blocked storage — fall through to the OS preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** Single place that touches the DOM class and storage. */
function applyTheme(isDark, persist = true) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  if (!persist) return
  try {
    window.localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light')
  } catch {
    /* storage unavailable — the in-memory theme still applies */
  }
}

const initial = resolveInitialTheme()
// Apply before first paint so there is no light-to-dark flash.
applyTheme(initial, false)

export const useThemeStore = create((set, get) => ({
  isDark: initial,

  toggleTheme: () => {
    const next = !get().isDark
    applyTheme(next)
    set({ isDark: next })
  },

  setTheme: (isDark) => {
    applyTheme(isDark)
    set({ isDark })
  },

  /** Re-read the OS preference (used when the user clears their choice). */
  followSystem: () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
    const next = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    applyTheme(next, false)
    set({ isDark: next })
  },
}))

export default useThemeStore
