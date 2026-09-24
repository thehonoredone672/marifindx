import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import Investigation from './pages/Investigation'
import ThreeDAnalysis from './pages/ThreeDAnalysis'
import Vessels from './pages/Vessels'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

// Theme is resolved and applied in themeStore before first paint, so no
// mount gate is needed here and there is no light-to-dark flash.
export default function App() {
  return (
    <Router>
      <div className="min-h-screen app-bg txt">
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
      </div>
    </Router>
  )
}
