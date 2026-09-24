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

const barColor = (v) =>
  v > 0.7 ? 'var(--accent)' : v > 0.4 ? 'var(--info)' : 'var(--border-strong)'

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
      <main className="min-h-screen pt-20 app-bg grid place-items-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold tracking-tight txt mb-2">Vessel Analysis</h1>
          <p className="txt-muted text-sm mb-6">
            {unreachable
              ? 'The backend is not reachable. Start it with: uvicorn backend.main:app --reload'
              : 'Run an investigation to load AIS candidates and their correlation evidence.'}
          </p>
          {!unreachable && (
            <button onClick={() => runDemo().catch(() => {})} disabled={loading} className="btn btn-accent">
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
                : <><Play className="w-3.5 h-3.5" /> Run Demo Investigation</>}
            </button>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen pt-20 pb-12 app-bg">
      <div className="max-w-5xl mx-auto px-4">
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight txt">AIS Vessel Analysis</h1>
          <p className="text-sm txt-muted mt-0.5 flex items-center gap-2 flex-wrap">
            {vessels.length} candidates ranked by correlation score
            {aisMeta.synthetic && <span className="pill pill-info">{aisMeta.label}</span>}
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <aside className="panel overflow-hidden self-start">
            <div className="panel-head">
              <h2 className="font-semibold text-sm txt">Candidates</h2>
            </div>
            <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto">
              {vessels.map((v) => {
                const isSel = v.id === selected?.id
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVessel(v.id)}
                    className="w-full text-left px-3 py-2.5 rounded-lg border transition-colors"
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
                      <span className="text-xs mono txt">{v.correlation_score?.toFixed(4)}</span>
                    </div>
                    <p className="text-[11px] txt-faint mt-0.5">{v.type}</p>
                    <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(v.correlation_score ?? 0) * 100}%`,
                          background: v.rank === 1 ? 'var(--accent)' : 'var(--info)',
                        }}
                      />
                    </div>
                  </button>
                )
              })}
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
                        <span className="text-[13px] txt-muted">{EVIDENCE_LABELS[key] ?? key}</span>
                        <span className="text-[13px] mono font-semibold txt">
                          {((ev.value ?? 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden mb-1" style={{ background: 'var(--border)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(ev.value ?? 0) * 100}%`, background: barColor(ev.value ?? 0) }}
                        />
                      </div>
                      <p className="text-[11px] txt-faint">{ev.detail}</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <p className="text-[11px] txt-faint leading-relaxed">
                {investigation.ranking?.disclaimer}
              </p>

              <Link
                to="/3d-analysis"
                className="inline-block text-[13px] font-medium"
                style={{ color: 'var(--accent)' }}
              >
                View in 3D time-lapse →
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function Panel({ title, children }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <h2 className="font-semibold text-sm txt">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="txt-muted">{label}</span>
      <span className="txt mono text-xs">{value ?? '—'}</span>
    </div>
  )
}
