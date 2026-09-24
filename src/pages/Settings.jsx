import React, { useState } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import useThemeStore from '../context/themeStore'

export default function Settings() {
  const { isDark, setTheme, followSystem } = useThemeStore()
  const [prefs, setPrefs] = useState({
    notifications: true,
    emailReports: true,
    autoRefresh: true,
  })

  const toggle = (key) => setPrefs((p) => ({ ...p, [key]: !p[key] }))

  return (
    <main className="min-h-screen pt-20 pb-12 app-bg">
      <div className="max-w-2xl mx-auto px-4">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight txt">Settings</h1>
          <p className="text-sm txt-muted mt-0.5">Application preferences</p>
        </header>

        <div className="space-y-4">
          <Panel title="Appearance">
            <p className="label-xs mb-2.5">Theme</p>
            <div className="seg w-full" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)' }}>
              <button data-active={!isDark} onClick={() => setTheme(false)}>
                <Sun className="w-3.5 h-3.5 inline mr-1.5" />Light
              </button>
              <button data-active={isDark} onClick={() => setTheme(true)}>
                <Moon className="w-3.5 h-3.5 inline mr-1.5" />Dark
              </button>
              <button data-active={false} onClick={followSystem}>
                <Monitor className="w-3.5 h-3.5 inline mr-1.5" />System
              </button>
            </div>
            <p className="mt-2.5 text-xs txt-faint">
              Your choice is saved locally. "System" clears it and follows the OS.
            </p>
          </Panel>

          <Panel title="Notifications">
            <Toggle
              label="Enable notifications"
              hint="Alerts for new investigations"
              on={prefs.notifications}
              onChange={() => toggle('notifications')}
            />
            <Toggle
              label="Email reports"
              hint="Send generated reports by email"
              on={prefs.emailReports}
              onChange={() => toggle('emailReports')}
            />
          </Panel>

          <Panel title="Data">
            <Toggle
              label="Auto-refresh"
              hint="Re-poll investigation data periodically"
              on={prefs.autoRefresh}
              onChange={() => toggle('autoRefresh')}
            />
            <div className="pt-3">
              <label className="label-xs block mb-1.5">Refresh interval</label>
              <select className="field w-full">
                <option>Every 1 minute</option>
                <option>Every 5 minutes</option>
                <option>Every 15 minutes</option>
                <option>Every hour</option>
              </select>
            </div>
          </Panel>

          <Panel title="About">
            <dl className="space-y-1.5 text-[13px]">
              <Row label="Application" value="MariFindX" />
              <Row label="Version" value="3.0.0" />
              <Row label="Problem statement" value="SIH26143" />
            </dl>
            <p className="mt-3 pt-3 border-t bd text-xs txt-faint leading-relaxed">
              Notification, email and refresh preferences above are interface
              state only — no scheduler is wired to them in this prototype.
            </p>
          </Panel>
        </div>
      </div>
    </main>
  )
}

function Panel({ title, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="font-semibold text-sm txt">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Toggle({ label, hint, on, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-[13px] font-medium txt">{label}</p>
        {hint && <p className="text-xs txt-faint mt-0.5">{hint}</p>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onChange}
        className="relative shrink-0 rounded-full transition-colors"
        style={{
          width: 40, height: 22,
          background: on ? 'var(--accent)' : 'var(--border-strong)',
        }}
      >
        <span
          className="absolute rounded-full bg-white transition-transform"
          style={{
            width: 16, height: 16, top: 3,
            transform: `translateX(${on ? 21 : 3}px)`,
          }}
        />
      </button>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="txt-muted">{label}</dt>
      <dd className="txt font-medium mono text-xs">{value}</dd>
    </div>
  )
}
