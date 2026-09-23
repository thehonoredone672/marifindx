import React from 'react'
import useInvestigationStore from '../../context/investigationStore'

const EVIDENCE_LABELS = [
  'Spatial proximity',
  'Temporal overlap',
  'Trajectory consistency',
  'Origin-zone crossing',
  'Drift consistency',
]

export default function VesselTable({ investigation }) {
  const { selectedVesselId, setSelectedVessel } = useInvestigationStore()
  const ranking = investigation?.ranking ?? {}
  const vessels = ranking.vessels ?? []
  const aisMeta = investigation?.ais?.meta ?? {}

  const selected = vessels.find((v) => v.id === selectedVesselId) ?? vessels[0]

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-white">AIS Vessel Correlation</h2>
        <div className="flex items-center gap-2">
          {aisMeta.synthetic && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300">
              {aisMeta.label}
            </span>
          )}
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300">
            Ranked
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2.5 text-left font-semibold">Rank</th>
              <th className="px-4 py-2.5 text-left font-semibold">Vessel</th>
              <th className="px-4 py-2.5 text-left font-semibold">Type</th>
              <th className="px-4 py-2.5 text-left font-semibold">MMSI</th>
              <th className="px-4 py-2.5 text-left font-semibold">Score</th>
              <th className="px-4 py-2.5 text-left font-semibold">Evidence</th>
              <th className="px-4 py-2.5 text-right font-semibold">Dist (km)</th>
              <th className="px-4 py-2.5 text-right font-semibold">Δt (h)</th>
            </tr>
          </thead>
          <tbody>
            {vessels.map((v) => {
              const isSel = v.id === selected?.id
              return (
                <tr
                  key={v.id}
                  onClick={() => setSelectedVessel(v.id)}
                  className={`border-b border-slate-800 cursor-pointer transition-colors ${
                    isSel ? 'bg-amber-500/10' : 'hover:bg-slate-800/50'
                  }`}
                >
                  <td className="px-4 py-2.5 font-bold text-white">{v.rank}</td>
                  <td className={`px-4 py-2.5 font-semibold ${
                    v.rank === 1 ? 'text-amber-400' : 'text-slate-200'
                  }`}>
                    {v.name}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{v.type}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{v.mmsi}</td>
                  <td className="px-4 py-2.5 font-mono font-bold text-white">
                    {v.correlation_score?.toFixed(4)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1" title={EVIDENCE_LABELS.join(' · ')}>
                      {(v.evidence_vector ?? []).map((val, i) => (
                        <div
                          key={i}
                          className="w-2.5 rounded-sm"
                          style={{
                            height: 18,
                            backgroundColor:
                              val > 0.7 ? '#f59e0b' : val > 0.4 ? '#3ba7f2' : '#334155',
                            opacity: 0.35 + val * 0.65,
                          }}
                          title={`${EVIDENCE_LABELS[i]}: ${(val * 100).toFixed(0)}%`}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                    {v.distance_km?.toFixed(2) ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                    {v.time_difference_hours?.toFixed(1) ?? '0.0'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="px-4 py-4 border-t border-slate-800 bg-slate-950/40">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-3">
            Evidence breakdown — {selected.name}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {Object.entries(selected.evidence ?? {}).map(([key, ev], i) => (
              <div key={key} className="p-3 rounded border border-slate-800 bg-slate-900">
                <div className="flex justify-between items-baseline mb-1.5">
                  <span className="text-[11px] text-slate-400">
                    {EVIDENCE_LABELS[i] ?? key}
                  </span>
                  <span className="text-sm font-bold text-white font-mono">
                    {((ev.value ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 rounded bg-slate-800 overflow-hidden mb-2">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${(ev.value ?? 0) * 100}%`,
                      backgroundColor:
                        ev.value > 0.7 ? '#f59e0b' : ev.value > 0.4 ? '#3ba7f2' : '#475569',
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-snug">{ev.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-4 border-t border-slate-800">
        <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Summary</p>
        <p className="text-sm leading-relaxed text-slate-300">{investigation?.summary}</p>

        {aisMeta.notice && (
          <p className="mt-3 text-xs text-purple-300/80 leading-relaxed">
            {aisMeta.notice}
          </p>
        )}

        <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500">
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
