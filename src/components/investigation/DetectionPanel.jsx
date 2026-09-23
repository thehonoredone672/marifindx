import React from 'react'

const fmt = (v, digits = 2, suffix = '') =>
  v === null || v === undefined || Number.isNaN(v)
    ? '—'
    : `${Number(v).toFixed(digits)}${suffix}`

export default function DetectionPanel({ investigation }) {
  const geom = investigation?.spill?.geometry ?? {}
  const conf = investigation?.spill?.confidence ?? {}
  const origin = investigation?.origin?.origin ?? {}
  const window = investigation?.origin?.release_window ?? {}
  const drift = investigation?.drift ?? {}

  const pct = Math.round((conf.score ?? 0) * 100)
  const tone =
    conf.category === 'HIGH' ? '#f59e0b'
      : conf.category === 'MEDIUM' ? '#3ba7f2' : '#64748b'

  const circumference = 2 * Math.PI * 40

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="font-semibold text-white">Detection</h2>
        <span
          className="px-2.5 py-1 rounded-full text-xs font-semibold"
          style={{ backgroundColor: `${tone}22`, color: tone }}
        >
          {investigation?.detection?.detected ? 'Detected' : 'None'}
        </span>
      </div>

      <div className="p-4">
        {/* Confidence dial */}
        <div className="flex items-center gap-4 mb-5">
          <div className="relative w-24 h-24 shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
              <circle cx="48" cy="48" r="40" fill="none" stroke="#1e293b" strokeWidth="6" />
              <circle
                cx="48" cy="48" r="40" fill="none"
                stroke={tone} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-bold" style={{ color: tone }}>{pct}%</span>
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Confidence</p>
            <p className="text-white font-semibold">{conf.category ?? '—'}</p>
            <p className="text-xs text-slate-500 mt-1">
              mean {fmt(conf.mean_probability, 3)} · p90 {fmt(conf.p90_probability, 3)}
            </p>
          </div>
        </div>

        {conf.lookalike_flags?.length > 0 && (
          <div className="mb-4 p-2.5 rounded border border-amber-500/30 bg-amber-500/10">
            <p className="text-xs font-semibold text-amber-300 mb-1">Look-alike guard</p>
            <ul className="text-xs text-amber-200/80 space-y-0.5">
              {conf.lookalike_flags.map((f, i) => <li key={i}>• {f}</li>)}
            </ul>
          </div>
        )}

        <Rows
          title="Spill geometry"
          rows={[
            ['Area', geom.area_km2 !== undefined
              ? fmt(geom.area_km2, 3, ' km²')
              : `${geom.area_px ?? '—'} px`],
            ['Length × Width',
              geom.length_km !== undefined
                ? `${fmt(geom.length_km)} × ${fmt(geom.width_km)} km`
                : '—'],
            ['Orientation', fmt(geom.orientation_deg, 1, '°')],
            ['Aspect ratio', geom.aspect_ratio ? `${fmt(geom.aspect_ratio)}:1` : '—'],
            ['Perimeter', fmt(geom.perimeter_km, 2, ' km')],
            ['Pixels', geom.pixel_count?.toLocaleString() ?? '—'],
            ['Regions', investigation?.spill?.regions ?? '—'],
          ]}
        />

        <Rows
          title="Probable origin"
          rows={[
            ['Latitude', fmt(origin.lat, 4, '°')],
            ['Longitude', fmt(origin.lon, 4, '°')],
            ['Uncertainty (68%)', fmt(origin.uncertainty_radius_km, 2, ' km')],
            ['Uncertainty (95%)', fmt(origin.radius_95_km, 2, ' km')],
            ['Release window',
              window.start
                ? `${window.start.slice(11, 16)} – ${window.end.slice(11, 16)} UTC`
                : '—'],
          ]}
        />

        <Rows
          title="Drift & environment"
          rows={[
            ['Drift speed', fmt(drift.drift_speed_ms, 3, ' m/s')],
            ['Drift direction', fmt(drift.drift_direction_deg, 0, '°')],
            ['Distance travelled', fmt(drift.total_distance_km, 2, ' km')],
            ['Current', `${fmt(drift.environment?.current_speed_ms, 2)} m/s @ ${fmt(drift.environment?.current_direction_deg, 0, '°')}`],
            ['Wind', `${fmt(drift.environment?.wind_speed_ms, 1)} m/s @ ${fmt(drift.environment?.wind_direction_deg, 0, '°')}`],
            ['Particles', drift.config?.particles ?? '—'],
            ['Integrator', (drift.config?.integrator ?? '—').toUpperCase()],
          ]}
          last
        />

        <p className="mt-4 pt-3 border-t border-slate-800 text-[11px] leading-relaxed text-slate-500">
          Potential oil spill. Origin is a probability zone from backward
          Lagrangian tracking, not a confirmed release point.
        </p>
      </div>
    </section>
  )
}

function Rows({ title, rows, last }) {
  return (
    <div className={last ? '' : 'mb-4 pb-4 border-b border-slate-800'}>
      <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">{title}</p>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-sm">
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-white font-medium font-mono text-[13px] text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
