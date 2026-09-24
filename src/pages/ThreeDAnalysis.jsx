import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Play, AlertTriangle } from 'lucide-react'
import useInvestigationStore from '../context/investigationStore'
import SpillScene3D from '../components/three/SpillScene3D'
import SpillMap from '../components/map/SpillMap'
import TimelapseControls from '../components/three/TimelapseControls'

/** Full-screen 3D showcase of the active investigation. */
export default function ThreeDAnalysis() {
  const {
    investigation, loading, error, modelStatus,
    checkModel, runDemo, viewMode, setViewMode,
    selectedVesselId, setSelectedVessel,
  } = useInvestigationStore()
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    checkModel().catch(() => setUnreachable(true))
  }, [checkModel])

  const vessels = investigation?.ranking?.vessels ?? []
  const origin = investigation?.origin?.origin ?? {}
  const geom = investigation?.spill?.geometry ?? {}
  const drift = investigation?.drift ?? {}

  if (unreachable || (modelStatus && !modelStatus.checkpoint_present)) {
    return (
      <main className="min-h-screen pt-20 app-bg grid place-items-center px-4">
        <div
          className="max-w-lg rounded-lg border p-7"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' }}
        >
          <div className="flex items-start gap-2.5 mb-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
            <h1 className="text-base font-semibold txt">
              {unreachable ? 'Backend unreachable' : 'Model checkpoint not found'}
            </h1>
          </div>
          <p className="txt-muted text-sm mb-3">
            {unreachable
              ? 'Start the API from the project root:'
              : 'Train a model before running the 3D analysis:'}
          </p>
          <code className="cmd">
            {unreachable
              ? 'uvicorn backend.main:app --reload'
              : 'python -m ml.train --config config.yaml --mode quick'}
          </code>
        </div>
      </main>
    )
  }

  if (!investigation) {
    return (
      <main className="min-h-screen pt-20 app-bg grid place-items-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold tracking-tight txt mb-2">3D Analysis</h1>
          <p className="txt-muted text-sm mb-6 leading-relaxed">
            Run an investigation to populate the 3D drift and vessel time-lapse.
            The scene renders the model's actual predicted spill polygon and the
            real drift particle simulation.
          </p>
          <button onClick={() => runDemo().catch(() => {})} disabled={loading} className="btn btn-accent">
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running pipeline…</>
              : <><Play className="w-3.5 h-3.5" /> Run Demo Investigation</>}
          </button>
          {error && <p className="mt-4 text-sm" style={{ color: 'var(--danger)' }}>{error.message}</p>}
          <p className="mt-6 text-xs txt-faint">
            Or open the{' '}
            <Link to="/investigation" style={{ color: 'var(--accent)' }}>Investigation dashboard</Link>.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen pt-14 app-bg flex flex-col">
      <div className="flex-1 flex flex-col xl:flex-row min-h-[calc(100vh-56px)]">
        <div className="flex-1 relative min-h-[420px]">
          {viewMode === '3d'
            ? <SpillScene3D investigation={investigation} />
            : <SpillMap investigation={investigation} />}

          <div className="absolute top-3 left-3 seg z-[500]">
            {['2d', '3d'].map((m) => (
              <button key={m} data-active={viewMode === m} onClick={() => setViewMode(m)}>
                {m === '2d' ? '2D Map' : '3D Projection'}
              </button>
            ))}
          </div>

          <div
            className="absolute bottom-3 left-3 rounded-lg border bd px-2.5 py-2 text-[11px] space-y-1 z-[500]"
            style={{ background: 'var(--surface)' }}
          >
            {[
              ['var(--accent)', 'Detected spill'],
              ['#0d9488', 'Probable origin / drift'],
              ['#fbbf24', 'Top candidate'],
              ['var(--text-faint)', 'Other vessels'],
            ].map(([c, l]) => (
              <div key={l} className="flex items-center gap-2 txt-muted">
                <span className="w-2 h-2 rounded-full" style={{ background: c }} />
                {l}
              </div>
            ))}
          </div>
        </div>

        <aside
          className="w-full xl:w-[320px] border-t xl:border-t-0 xl:border-l bd overflow-y-auto max-h-[calc(100vh-56px)]"
          style={{ background: 'var(--surface)' }}
        >
          <Section title="Spill">
            <Row label="Area" value={geom.area_km2 ? `${geom.area_km2.toFixed(2)} km²` : '—'} />
            <Row label="Length × Width" value={geom.length_km ? `${geom.length_km.toFixed(1)} × ${geom.width_km.toFixed(1)} km` : '—'} />
            <Row label="Orientation" value={geom.orientation_deg ? `${geom.orientation_deg.toFixed(1)}°` : '—'} />
            <Row label="Aspect ratio" value={geom.aspect_ratio ? `${geom.aspect_ratio.toFixed(2)}:1` : '—'} />
            <Row label="Confidence" value={`${investigation.spill?.confidence?.category} (${((investigation.spill?.confidence?.score ?? 0) * 100).toFixed(0)}%)`} />
          </Section>

          <Section title="Probable origin">
            <Row label="Latitude" value={origin.lat ? `${origin.lat.toFixed(4)}°` : '—'} />
            <Row label="Longitude" value={origin.lon ? `${origin.lon.toFixed(4)}°` : '—'} />
            <Row label="Uncertainty 68%" value={`${origin.uncertainty_radius_km?.toFixed(2)} km`} />
            <Row label="Release window" value={`${investigation.origin?.release_window?.start?.slice(11, 16)}–${investigation.origin?.release_window?.end?.slice(11, 16)} UTC`} />
          </Section>

          <Section title="Environment">
            <Row label="Current" value={`${drift.environment?.current_speed_ms?.toFixed(2)} m/s @ ${drift.environment?.current_direction_deg?.toFixed(0)}°`} />
            <Row label="Wind" value={`${drift.environment?.wind_speed_ms?.toFixed(1)} m/s @ ${drift.environment?.wind_direction_deg?.toFixed(0)}°`} />
            <Row label="Drift speed" value={`${drift.drift_speed_ms?.toFixed(3)} m/s`} />
            <Row label="Distance" value={`${drift.total_distance_km?.toFixed(2)} km`} />
          </Section>

          <Section title={`Vessels (${vessels.length})`}>
            <div className="space-y-1">
              {vessels.map((v) => {
                const isSel = v.id === selectedVesselId
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVessel(v.id)}
                    className="w-full text-left px-2.5 py-2 rounded-lg border transition-colors"
                    style={{
                      borderColor: isSel ? 'var(--accent-border)' : 'transparent',
                      background: isSel ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    <div className="flex justify-between items-baseline gap-2">
                      <span
                        className="text-[13px] font-medium"
                        style={{ color: v.rank === 1 ? 'var(--accent)' : 'var(--text)' }}
                      >
                        #{v.rank} {v.name}
                      </span>
                      <span className="text-xs mono txt">{v.correlation_score?.toFixed(3)}</span>
                    </div>
                    <p className="text-[11px] txt-faint mt-0.5">
                      {v.type} · {v.distance_km?.toFixed(2)} km from origin
                    </p>
                  </button>
                )
              })}
            </div>
          </Section>

          {investigation.ais?.meta?.synthetic && (
            <div
              className="mx-4 mb-4 p-2.5 rounded-lg border"
              style={{ background: 'var(--info-soft)', borderColor: 'var(--info)' }}
            >
              <p className="text-[11px] leading-snug" style={{ color: 'var(--info)' }}>
                {investigation.ais.meta.notice}
              </p>
            </div>
          )}
        </aside>
      </div>

      <TimelapseControls />
    </main>
  )
}

function Section({ title, children }) {
  return (
    <div className="px-4 py-4 border-b bd">
      <p className="label-xs mb-2.5">{title}</p>
      {children}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-[13px] py-0.5">
      <span className="txt-muted">{label}</span>
      <span className="txt mono text-xs text-right">{value}</span>
    </div>
  )
}
