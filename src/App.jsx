import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { useThemeStore } from './context/themeStore'
import Navbar from './components/layout/Navbar'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import Investigation from './pages/Investigation'
import ThreeDAnalysis from './pages/ThreeDAnalysis'
import Vessels from './pages/Vessels'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

function App() {
  const { isDark } = useThemeStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('theme')
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const shouldBeDark = savedTheme ? savedTheme === 'dark' : systemDark

    if (shouldBeDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  useEffect(() => {
    if (!mounted) return

    if (isDark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [isDark, mounted])

  if (!mounted) {
    return null
  }

  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/investigation" element={<Investigation />} />
        <Route path="/3d-analysis" element={<ThreeDAnalysis />} />
        <Route path="/vessels" element={<Vessels />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Router>
  )
}

export default App
