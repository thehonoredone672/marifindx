import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Radar, Waves, Ship } from 'lucide-react'

const STEPS = [
  { icon: Radar, title: 'Satellite detection', body: 'Attention U-Net segments dual-pol Sentinel-1 SAR into a georeferenced spill polygon.' },
  { icon: Waves, title: 'Drift reconstruction', body: 'Backward Lagrangian particle tracking narrows the release point to a probability zone.' },
  { icon: Ship, title: 'Vessel correlation', body: 'AIS trajectories are scored on proximity, timing, heading and drift agreement.' },
]

export default function Landing() {
  return (
    <main className="min-h-screen app-bg">
      <div className="h-14" />

      <section className="max-w-3xl mx-auto px-4 pt-20 pb-16">
        <p className="label-xs mb-4">Marine intelligence prototype · SIH26143</p>

        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight txt leading-[1.08] mb-5">
          Oil spill detection and vessel attribution
        </h1>

        <p className="text-base txt-muted leading-relaxed max-w-2xl mb-8">
          MariFindX segments oil slicks from Sentinel-1 SAR imagery, reconstructs
          where the release most likely occurred, and ranks nearby AIS vessels by
          how well their movement matches the evidence.
        </p>

        <div className="flex flex-wrap gap-2.5">
          <Link to="/investigation" className="btn btn-accent">
            Open investigation <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link to="/dashboard" className="btn btn-quiet">Model status</Link>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 pb-20">
        <ol className="grid gap-px rounded-lg overflow-hidden border bd" style={{ background: 'var(--border)' }}>
          {STEPS.map((s, i) => (
            <li key={s.title} className="surface p-5 flex gap-4">
              <div className="shrink-0">
                <span className="label-xs mono">0{i + 1}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <s.icon className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  <h2 className="font-medium txt text-[15px]">{s.title}</h2>
                </div>
                <p className="text-sm txt-muted leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-6 text-xs txt-faint leading-relaxed">
          Output is a ranked candidate association for investigative support —
          not a determination of legal responsibility. The bundled model is
          trained on synthetic scenes; see the README before quoting any metric.
        </p>
      </section>
    </main>
  )
}
