import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X, Moon, Sun } from 'lucide-react'
import useThemeStore from '../../context/themeStore'

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Investigation', href: '/investigation' },
  { label: '3D Analysis', href: '/3d-analysis' },
  { label: 'Vessels', href: '/vessels' },
  { label: 'Reports', href: '/reports' },
  { label: 'Settings', href: '/settings' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const { isDark, toggleTheme } = useThemeStore()
  const { pathname } = useLocation()

  return (
    <header
      className="fixed top-0 inset-x-0 z-[1000] border-b"
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
    >
      <nav className="max-w-[1600px] mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <span
              className="w-6 h-6 rounded-md grid place-items-center text-[11px] font-bold text-white"
              style={{ background: 'var(--accent)' }}
            >
              M
            </span>
            <span className="font-semibold tracking-tight txt">MariFindX</span>
          </Link>

          <ul className="hidden lg:flex items-center gap-0.5">
            {NAV.map((item) => {
              const active = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    aria-current={active ? 'page' : undefined}
                    className="px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors"
                    style={{
                      color: active ? 'var(--text)' : 'var(--text-muted)',
                      background: active ? 'var(--surface-2)' : 'transparent',
                    }}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              className="btn-icon"
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={isDark ? 'Light theme' : 'Dark theme'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setOpen((v) => !v)}
              className="btn-icon lg:hidden"
              aria-label="Toggle navigation"
              aria-expanded={open}
            >
              {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {open && (
          <ul className="lg:hidden pb-3 grid gap-0.5">
            {NAV.map((item) => {
              const active = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 rounded-md text-sm font-medium"
                    style={{
                      color: active ? 'var(--text)' : 'var(--text-muted)',
                      background: active ? 'var(--surface-2)' : 'transparent',
                    }}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </header>
  )
}
