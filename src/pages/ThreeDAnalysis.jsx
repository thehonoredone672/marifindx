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
      <div className="min-h-screen pt-20 bg-slate-950 flex items-center justify-center px-4">
        <div className="max-w-lg rounded-lg border border-amber-500/40 bg-amber-500/10 p-8">
          <div className="flex items-start gap-3 mb-3">
            <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <h1 className="text-lg font-bold text-white">
              {unreachable ? 'Backend unreachable' : 'Model checkpoint not found'}
            </h1>
          </div>
          <p className="text-slate-300 text-sm mb-4">
            {unreachable
              ? 'Start the API from the project root:'
              : 'Train a model before running the 3D analysis:'}
          </p>
          <code className="block p-3 rounded bg-slate-950 text-emerald-300 font-mono text-sm">
            {unreachable
              ? 'uvicorn backend.main:app --reload'
              : 'python -m ml.train --config config.yaml --mode quick'}
          </code>
        </div>
      </div>
    )
  }

  if (!investigation) {
    return (
      <div className="min-h-screen pt-20 bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-white mb-3">3D Analysis</h1>
          <p className="text-slate-400 text-sm mb-6">
            Run an investigation to populate the 3D drift and vessel time-lapse.
            The scene renders the model's actual predicted spill polygon and the
            real drift particle simulation.
          </p>
          <button
            onClick={() => runDemo().catch(() => {})}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold inline-flex items-center gap-2"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Running pipeline…</>
              : <><Play className="w-4 h-4" /> Run Demo Investigation</>}
          </button>
          {error && <p className="mt-4 text-sm text-red-400">{error.message}</p>}
          <p className="mt-6 text-xs text-slate-600">
            Or open the <Link to="/investigation" className="text-amber-500 hover:underline">Investigation dashboard</Link>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-16 bg-slate-950 flex flex-col">
      <div className="flex-1 flex flex-col xl:flex-row min-h-[calc(100vh-64px)]">
        {/* Scene */}
        <div className="flex-1 relative min-h-[420px]">
          {viewMode === '3d'
            ? <SpillScene3D investigation={investigation} />
            : <SpillMap investigation={investigation} />}

          <div className="absolute top-3 left-3 flex rounded-lg border border-slate-700 overflow-hidden z-[500]">
            {['2d', '3d'].map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  viewMode === m ? 'bg-amber-600 text-white' : 'bg-slate-900/90 text-slate-300'
                }`}
              >
                {m === '2d' ? '2D Map' : '3D Projection'}
              </button>
            ))}
          </div>

          <div className="absolute bottom-3 left-3 rounded bg-slate-950/85 border border-slate-700 px-3 py-2 text-[11px] space-y-1 z-[500]">
            {[
              ['#f59e0b', 'Detected spill'],
              ['#7FE7D6', 'Probable origin / drift'],
              ['#fbbf24', 'Top candidate'],
              ['#64748b', 'Other vessels'],
            ].map(([c, l]) => (
              <div key={l} className="flex items-center gap-2 text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                {l}
              </div>
            ))}
          </div>
        </div>

        {/* Side panel */}
        <aside className="w-full xl:w-[340px] border-l border-slate-800 bg-slate-900 overflow-y-auto max-h-[calc(100vh-64px)]">
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
            <div className="space-y-1.5">
              {vessels.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVessel(v.id)}
                  className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                    v.id === selectedVesselId
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'
                  }`}
                >
                  <div className="flex justify-between items-baseline gap-2">
                    <span className={`text-sm font-semibold ${v.rank === 1 ? 'text-amber-400' : 'text-slate-200'}`}>
                      #{v.rank} {v.name}
                    </span>
                    <span className="text-xs font-mono text-white">
                      {v.correlation_score?.toFixed(3)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {v.type} · {v.distance_km?.toFixed(2)} km from origin
                  </p>
                </button>
              ))}
            </div>
          </Section>

          {investigation.ais?.meta?.synthetic && (
            <div className="mx-4 mb-4 p-2.5 rounded border border-purple-500/30 bg-purple-500/10">
              <p className="text-[11px] text-purple-300 leading-snug">
                {investigation.ais.meta.notice}
              </p>
            </div>
          )}
        </aside>
      </div>

      <TimelapseControls />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="px-4 py-4 border-b border-slate-800">
      <p className="text-xs uppercase tracking-wider text-slate-500 mb-2.5">{title}</p>
      {children}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-sm py-0.5">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-mono text-[13px] text-right">{value}</span>
    </div>
  )
}
