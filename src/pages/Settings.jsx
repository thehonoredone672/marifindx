import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Moon, Sun, Bell, Lock, Database, Eye } from 'lucide-react'
import { useThemeStore } from '../context/themeStore'

export default function Settings() {
  const { isDark, toggleTheme } = useThemeStore()
  const [settings, setSettings] = useState({
    notifications: true,
    emailReports: true,
    autoRefresh: true,
    twoFactor: false,
  })

  const handleToggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="min-h-screen pt-20 pb-12 bg-slate-900">
      <div className="max-w-3xl mx-auto px-4">
        {/* Header */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
          <p className="text-gray-400">Manage application preferences</p>
        </motion.div>

        <div className="space-y-6">
          {/* Appearance */}
          <motion.div
            className="p-6 rounded-lg border border-slate-700 bg-slate-800"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h3 className="text-lg font-bold text-white mb-4">Appearance</h3>

            <div className="flex items-center justify-between p-4 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-all">
              <div className="flex items-center gap-3">
                {isDark ? (
                  <Moon className="w-5 h-5 text-amber-400" />
                ) : (
                  <Sun className="w-5 h-5 text-amber-400" />
                )}
                <div>
                  <p className="font-semibold text-white">Dark Mode</p>
                  <p className="text-sm text-gray-400">{isDark ? 'Enabled' : 'Disabled'}</p>
                </div>
              </div>
              <button
                onClick={toggleTheme}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                  isDark ? 'bg-amber-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    isDark ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </motion.div>

          {/* Notifications */}
          <motion.div
            className="p-6 rounded-lg border border-slate-700 bg-slate-800"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <h3 className="text-lg font-bold text-white mb-4">Notifications</h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-all">
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="font-semibold text-white">Enable Notifications</p>
                    <p className="text-sm text-gray-400">Receive alerts for new investigations</p>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle('notifications')}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                    settings.notifications ? 'bg-blue-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                      settings.notifications ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-all">
                <div>
                  <p className="font-semibold text-white">Email Reports</p>
                  <p className="text-sm text-gray-400">Send reports via email</p>
                </div>
                <button
                  onClick={() => handleToggle('emailReports')}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                    settings.emailReports ? 'bg-blue-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                      settings.emailReports ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </motion.div>

          {/* Data & Sync */}
          <motion.div
            className="p-6 rounded-lg border border-slate-700 bg-slate-800"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h3 className="text-lg font-bold text-white mb-4">Data & Sync</h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-all">
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5 text-green-400" />
                  <div>
                    <p className="font-semibold text-white">Auto-Refresh</p>
                    <p className="text-sm text-gray-400">Sync data automatically</p>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle('autoRefresh')}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                    settings.autoRefresh ? 'bg-green-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                      settings.autoRefresh ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Refresh Interval</label>
                <select className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white">
                  <option>Every 1 minute</option>
                  <option>Every 5 minutes</option>
                  <option>Every 15 minutes</option>
                  <option>Every hour</option>
                </select>
              </div>
            </div>
          </motion.div>

          {/* Security */}
          <motion.div
            className="p-6 rounded-lg border border-slate-700 bg-slate-800"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <h3 className="text-lg font-bold text-white mb-4">Security</h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-all">
                <div className="flex items-center gap-3">
                  <Lock className="w-5 h-5 text-red-400" />
                  <div>
                    <p className="font-semibold text-white">Two-Factor Authentication</p>
                    <p className="text-sm text-gray-400">{settings.twoFactor ? 'Enabled' : 'Disabled'}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle('twoFactor')}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                    settings.twoFactor ? 'bg-red-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                      settings.twoFactor ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <button className="w-full p-3 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-left font-semibold text-white transition-all">
                Change Password
              </button>
            </div>
          </motion.div>

          {/* About */}
          <motion.div
            className="p-6 rounded-lg border border-slate-700 bg-slate-800"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h3 className="text-lg font-bold text-white mb-4">About</h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Application</span>
                <span className="text-white font-semibold">MariFindX</span>
              </div>
              <div className="flex justify-between border-t border-slate-700 pt-3">
                <span className="text-gray-400">Version</span>
                <span className="text-white font-semibold">2.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Build</span>
                <span className="font-mono text-white">2026.09.22</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
