import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Loader2 } from 'lucide-react'
import useInvestigationStore from '../context/investigationStore'

const EVIDENCE_LABELS = {
  spatial_proximity: 'Spatial proximity',
  temporal_overlap: 'Temporal overlap',
  trajectory_consistency: 'Trajectory consistency',
  origin_zone: 'Origin-zone crossing',
  drift_consistency: 'Drift consistency',
}

export default function Vessels() {
  const {
    investigation, loading, runDemo,
    selectedVesselId, setSelectedVessel, checkModel,
  } = useInvestigationStore()
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    checkModel().catch(() => setUnreachable(true))
  }, [checkModel])

  const vessels = investigation?.ranking?.vessels ?? []
  const selected = vessels.find((v) => v.id === selectedVesselId) ?? vessels[0]
  const aisMeta = investigation?.ais?.meta ?? {}

  if (!investigation) {
    return (
      <div className="min-h-screen pt-20 bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-white mb-3">Vessel Analysis</h1>
          <p className="text-slate-400 text-sm mb-6">
            {unreachable
              ? 'The backend is not reachable. Start it with: uvicorn backend.main:app --reload'
              : 'Run an investigation to load AIS candidates and their correlation evidence.'}
          </p>
          {!unreachable && (
            <button
              onClick={() => runDemo().catch(() => {})}
              disabled={loading}
              className="px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold inline-flex items-center gap-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
                : <><Play className="w-4 h-4" /> Run Demo Investigation</>}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-20 pb-12 bg-slate-950">
      <div className="max-w-6xl mx-auto px-4">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-white">AIS Vessel Analysis</h1>
          <p className="text-sm text-slate-400">
            {vessels.length} candidates ranked by correlation score
            {aisMeta.synthetic && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/20 text-purple-300">
                {aisMeta.label}
              </span>
            )}
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
          <aside className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="font-semibold text-white text-sm">Candidates</h2>
            </div>
            <div className="p-2 space-y-1.5 max-h-[70vh] overflow-y-auto">
              {vessels.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVessel(v.id)}
                  className={`w-full text-left px-3 py-2.5 rounded border transition-colors ${
                    v.id === selected?.id
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-slate-800 hover:border-slate-600'
                  }`}
                >
                  <div className="flex justify-between items-baseline gap-2">
                    <span className={`text-sm font-semibold ${
                      v.rank === 1 ? 'text-amber-400' : 'text-slate-200'
                    }`}>
                      #{v.rank} {v.name}
                    </span>
                    <span className="text-xs font-mono text-white">
                      {v.correlation_score?.toFixed(4)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{v.type}</p>
                  <div className="mt-1.5 h-1 rounded bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${(v.correlation_score ?? 0) * 100}%`,
                        backgroundColor: v.rank === 1 ? '#f59e0b' : '#3BA7F2',
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {selected && (
            <div className="space-y-4">
              <Panel title={selected.name}>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <Row label="MMSI" value={selected.mmsi} />
                  <Row label="Type" value={selected.type} />
                  <Row label="Rank" value={`#${selected.rank}`} />
                  <Row label="Score" value={selected.correlation_score?.toFixed(4)} />
                  <Row label="Distance to origin" value={`${selected.distance_km?.toFixed(2)} km`} />
                  <Row label="Δt to release" value={`${selected.time_difference_hours?.toFixed(1)} h`} />
                  <Row label="Speed" value={`${selected.movement?.speed?.toFixed(1)} kn`} />
                  <Row label="Heading" value={`${selected.movement?.heading?.toFixed(0)}°`} />
                  <Row label="AIS reports" value={selected.point_count} />
                  <Row label="Source" value={selected.synthetic ? 'Synthetic' : 'Real AIS'} />
                </div>
              </Panel>

              <Panel title="Correlation evidence">
                <div className="space-y-3">
                  {Object.entries(selected.evidence ?? {}).map(([key, ev]) => (
                    <div key={key}>
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-sm text-slate-300">
                          {EVIDENCE_LABELS[key] ?? key}
                        </span>
                        <span className="text-sm font-mono font-bold text-white">
                          {((ev.value ?? 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded bg-slate-800 overflow-hidden mb-1">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${(ev.value ?? 0) * 100}%`,
                            backgroundColor:
                              ev.value > 0.7 ? '#f59e0b'
                                : ev.value > 0.4 ? '#3BA7F2' : '#475569',
                          }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-500">{ev.detail}</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                {investigation.ranking?.disclaimer}
              </p>

              <Link
                to="/3d-analysis"
                className="inline-block text-sm text-amber-500 hover:text-amber-400 font-semibold"
              >
                View in 3D time-lapse →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="font-semibold text-white text-sm">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-mono text-[13px]">{value ?? '—'}</span>
    </div>
  )
}
