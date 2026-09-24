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
    conf.category === 'HIGH' ? 'var(--accent)'
      : conf.category === 'MEDIUM' ? 'var(--info)' : 'var(--text-faint)'

  const circumference = 2 * Math.PI * 34

  return (
    <section className="panel overflow-hidden self-start">
      <div className="panel-head">
        <h2 className="font-semibold text-sm txt">Detection</h2>
        <span className="pill pill-accent">
          {investigation?.detection?.detected ? 'Detected' : 'None'}
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-4 mb-5">
          <div className="relative w-[84px] h-[84px] shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 84 84">
              <circle cx="42" cy="42" r="34" fill="none" stroke="var(--border)" strokeWidth="5" />
              <circle
                cx="42" cy="42" r="34" fill="none"
                stroke={tone} strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <span className="text-lg font-semibold mono" style={{ color: tone }}>{pct}%</span>
            </div>
          </div>
          <div>
            <p className="label-xs mb-1">Confidence</p>
            <p className="txt font-medium text-sm">{conf.category ?? '—'}</p>
            <p className="text-xs txt-faint mt-0.5 mono">
              mean {fmt(conf.mean_probability, 3)} · p90 {fmt(conf.p90_probability, 3)}
            </p>
          </div>
        </div>

        {conf.lookalike_flags?.length > 0 && (
          <div
            className="mb-4 p-2.5 rounded-lg border"
            style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--accent)' }}>
              Look-alike guard
            </p>
            <ul className="text-xs txt-muted space-y-0.5">
              {conf.lookalike_flags.map((f, i) => <li key={i}>· {f}</li>)}
            </ul>
          </div>
        )}

        <Rows
          title="Spill geometry"
          rows={[
            ['Area', geom.area_km2 !== undefined ? fmt(geom.area_km2, 3, ' km²') : `${geom.area_px ?? '—'} px`],
            ['Length × Width', geom.length_km !== undefined ? `${fmt(geom.length_km)} × ${fmt(geom.width_km)} km` : '—'],
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
            ['Release window', window.start ? `${window.start.slice(11, 16)} – ${window.end.slice(11, 16)} UTC` : '—'],
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

        <p className="mt-4 pt-3 border-t bd text-[11px] leading-relaxed txt-faint">
          Potential oil spill. Origin is a probability zone from backward
          Lagrangian tracking, not a confirmed release point.
        </p>
      </div>
    </section>
  )
}

function Rows({ title, rows, last }) {
  return (
    <div className={last ? '' : 'mb-4 pb-4 border-b bd'}>
      <p className="label-xs mb-2">{title}</p>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-[13px]">
            <dt className="txt-muted">{label}</dt>
            <dd className="txt font-medium mono text-xs text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
