import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X, Moon, Sun, Bell, User } from 'lucide-react'
import { useThemeStore } from '../../context/themeStore'

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const { isDark, toggleTheme } = useThemeStore()

  const navItems = [
    { label: 'Home', href: '/' },
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Investigation', href: '/investigation' },
    { label: '3D Analysis', href: '/3d-analysis' },
    { label: 'Vessels', href: '/vessels' },
    { label: 'Reports', href: '/reports' },
    { label: 'Settings', href: '/settings' },
  ]

  return (
    <nav className="glass fixed top-0 left-0 right-0 z-50 border-b border-opacity-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2 flex-shrink-0 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent flex items-center justify-center text-white font-bold">
              M
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-primary-600 to-secondary hidden sm:inline">
              MariFindX
            </span>
          </Link>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center space-x-1">
            {navItems.map(item => (
              <Link
                key={item.href}
                to={item.href}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-all hover:bg-white/10 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200"
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Right Side Actions */}
          <div className="flex items-center space-x-3">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-all"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <Sun className="w-5 h-5 text-amber-400" />
              ) : (
                <Moon className="w-5 h-5 text-gray-600" />
              )}
            </button>

            {/* Notifications */}
            <button className="p-2 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-all relative">
              <Bell className="w-5 h-5 text-gray-700 dark:text-gray-200" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>

            {/* User Profile */}
            <button className="p-2 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-all">
              <User className="w-5 h-5 text-gray-700 dark:text-gray-200" />
            </button>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-all"
            >
              {isOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isOpen && (
          <div className="md:hidden pb-3 space-y-1">
            {navItems.map(item => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setIsOpen(false)}
                className="block px-3 py-2 rounded-lg text-sm font-medium transition-all hover:bg-white/10 dark:hover:bg-white/5"
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
