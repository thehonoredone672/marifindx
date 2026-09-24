import React from 'react'
import useInvestigationStore from '../../context/investigationStore'

const EVIDENCE_LABELS = [
  'Spatial proximity',
  'Temporal overlap',
  'Trajectory consistency',
  'Origin-zone crossing',
  'Drift consistency',
]

const barColor = (v) =>
  v > 0.7 ? 'var(--accent)' : v > 0.4 ? 'var(--info)' : 'var(--border-strong)'

export default function VesselTable({ investigation }) {
  const { selectedVesselId, setSelectedVessel } = useInvestigationStore()
  const ranking = investigation?.ranking ?? {}
  const vessels = ranking.vessels ?? []
  const aisMeta = investigation?.ais?.meta ?? {}

  const selected = vessels.find((v) => v.id === selectedVesselId) ?? vessels[0]

  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <h2 className="font-semibold text-sm txt">AIS Vessel Correlation</h2>
        <div className="flex items-center gap-2">
          {aisMeta.synthetic && <span className="pill pill-info">{aisMeta.label}</span>}
          <span className="pill pill-accent">Ranked</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="surface-2">
              {['Rank', 'Vessel', 'Type', 'MMSI', 'Score', 'Evidence', 'Dist (km)', 'Δt (h)'].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-2 label-xs ${i >= 6 ? 'text-right' : 'text-left'}`}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vessels.map((v) => {
              const isSel = v.id === selected?.id
              return (
                <tr
                  key={v.id}
                  onClick={() => setSelectedVessel(v.id)}
                  className={isSel ? '' : 'row-hover'}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: isSel ? 'var(--accent-soft)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <td className="px-4 py-2.5 font-semibold txt mono">{v.rank}</td>
                  <td
                    className="px-4 py-2.5 font-medium"
                    style={{ color: v.rank === 1 ? 'var(--accent)' : 'var(--text)' }}
                  >
                    {v.name}
                  </td>
                  <td className="px-4 py-2.5 txt-muted">{v.type}</td>
                  <td className="px-4 py-2.5 txt-muted mono text-xs">{v.mmsi}</td>
                  <td className="px-4 py-2.5 mono font-semibold txt">
                    {v.correlation_score?.toFixed(4)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-[3px]">
                      {(v.evidence_vector ?? []).map((val, i) => (
                        <span
                          key={i}
                          title={`${EVIDENCE_LABELS[i]}: ${(val * 100).toFixed(0)}%`}
                          style={{
                            width: 9,
                            height: 16,
                            borderRadius: 2,
                            display: 'inline-block',
                            background: barColor(val),
                            opacity: 0.3 + val * 0.7,
                          }}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right mono txt-muted">
                    {v.distance_km?.toFixed(2) ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right mono txt-muted">
                    {v.time_difference_hours?.toFixed(1) ?? '0.0'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="px-4 py-4 border-t bd surface-2">
          <p className="label-xs mb-3">Evidence breakdown — {selected.name}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2.5">
            {Object.entries(selected.evidence ?? {}).map(([key, ev], i) => (
              <div key={key} className="p-2.5 rounded-lg border bd surface">
                <div className="flex justify-between items-baseline mb-1.5">
                  <span className="text-[11px] txt-muted">{EVIDENCE_LABELS[i] ?? key}</span>
                  <span className="text-[13px] font-semibold txt mono">
                    {((ev.value ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden mb-2" style={{ background: 'var(--border)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(ev.value ?? 0) * 100}%`, background: barColor(ev.value ?? 0) }}
                  />
                </div>
                <p className="text-[11px] txt-faint leading-snug">{ev.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-4 border-t bd">
        <p className="label-xs mb-2">Summary</p>
        <p className="text-[13px] leading-relaxed txt-muted">{investigation?.summary}</p>

        {aisMeta.notice && (
          <p className="mt-2.5 text-xs leading-relaxed" style={{ color: 'var(--info)' }}>
            {aisMeta.notice}
          </p>
        )}

        <div className="mt-3 pt-3 border-t bd flex flex-wrap gap-x-5 gap-y-1 text-[11px] txt-faint">
          <span>Method: {ranking.method}</span>
          {ranking.weights && (
            <span>
              Weights — proximity {ranking.weights.proximity}, temporal {ranking.weights.temporal},
              trajectory {ranking.weights.trajectory}, origin {ranking.weights.origin},
              drift {ranking.weights.drift}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
