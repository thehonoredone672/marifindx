import React, { useMemo } from 'react'
import {
  MapContainer, TileLayer, Polygon, Polyline, Circle, CircleMarker, Tooltip,
} from 'react-leaflet'
import useInvestigationStore from '../../context/investigationStore'

/**
 * 2D view of the investigation. Every layer is drawn from the real
 * pipeline output -- the spill polygon comes from the model's predicted
 * mask after georeferencing, not from a hand-placed shape.
 */
export default function SpillMap({ investigation }) {
  const { selectedVesselId, setSelectedVessel, simulationTime } =
    useInvestigationStore()

  const spill = investigation?.spill ?? {}
  const origin = investigation?.origin?.origin ?? {}
  const vessels = investigation?.ranking?.vessels ?? []
  const driftPath = investigation?.drift?.path ?? []
  const sim = investigation?.simulation ?? {}

  // GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
  const spillPositions = useMemo(
    () => (spill.polygon ?? []).map(([lon, lat]) => [lat, lon]),
    [spill.polygon],
  )

  const driftPositions = useMemo(
    () => driftPath.map((p) => [p.lat, p.lon]),
    [driftPath],
  )

  const center = useMemo(() => {
    if (spill.centroid) return [spill.centroid.lat, spill.centroid.lon]
    if (origin.lat !== undefined) return [origin.lat, origin.lon]
    return [19.0, 71.9]
  }, [spill.centroid, origin.lat, origin.lon])

  const currentDate = useMemo(() => {
    if (!sim.start_time) return null
    return new Date(new Date(sim.start_time).getTime() + simulationTime * 60000)
  }, [sim.start_time, simulationTime])

  /** Interpolate a vessel's AIS track to the current simulation instant. */
  const positionAt = (vessel) => {
    const traj = vessel.trajectory ?? []
    if (!traj.length) return null
    if (!currentDate) return [traj[traj.length - 1].lat, traj[traj.length - 1].lon]

    const t = currentDate.getTime()
    if (t <= new Date(traj[0].time).getTime()) return [traj[0].lat, traj[0].lon]
    const last = traj[traj.length - 1]
    if (t >= new Date(last.time).getTime()) return [last.lat, last.lon]

    for (let i = 0; i < traj.length - 1; i += 1) {
      const t0 = new Date(traj[i].time).getTime()
      const t1 = new Date(traj[i + 1].time).getTime()
      if (t >= t0 && t <= t1) {
        const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
        return [
          traj[i].lat + f * (traj[i + 1].lat - traj[i].lat),
          traj[i].lon + f * (traj[i + 1].lon - traj[i].lon),
        ]
      }
    }
    return [last.lat, last.lon]
  }

  if (!spillPositions.length && origin.lat === undefined) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        No georeferenced geometry available for this scene.
      </div>
    )
  }

  return (
    <div className="h-full w-full relative">
      <MapContainer
        center={center}
        zoom={10}
        style={{ height: '100%', width: '100%', background: '#0f172a' }}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {/* Origin uncertainty zone (68% particle containment) */}
        {origin.lat !== undefined && (
          <>
            <Circle
              center={[origin.lat, origin.lon]}
              radius={(origin.uncertainty_radius_km ?? 1) * 1000}
              pathOptions={{ color: '#7FE7D6', fillColor: '#7FE7D6', fillOpacity: 0.1, weight: 1, dashArray: '6 6' }}
            />
            <CircleMarker
              center={[origin.lat, origin.lon]}
              radius={7}
              pathOptions={{ color: '#7FE7D6', fillColor: '#7FE7D6', fillOpacity: 0.9, weight: 2 }}
            >
              <Tooltip>Probable origin (±{origin.uncertainty_radius_km?.toFixed(1)} km)</Tooltip>
            </CircleMarker>
          </>
        )}

        {/* Drift corridor */}
        {driftPositions.length > 1 && (
          <Polyline
            positions={driftPositions}
            pathOptions={{ color: '#7FE7D6', weight: 2, opacity: 0.7, dashArray: '4 6' }}
          />
        )}

        {/* Detected spill polygon */}
        {spillPositions.length > 2 && (
          <Polygon
            positions={spillPositions}
            pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.35, weight: 2 }}
          >
            <Tooltip>
              Potential oil spill — {spill.geometry?.area_km2?.toFixed(2)} km²
            </Tooltip>
          </Polygon>
        )}

        {/* AIS tracks + animated positions */}
        {vessels.map((v) => {
          const isSel = v.id === selectedVesselId
          const isTop = v.rank === 1
          const color = isTop ? '#fbbf24' : isSel ? '#3BA7F2' : '#64748b'
          const track = (v.trajectory ?? []).map((p) => [p.lat, p.lon])
          const pos = positionAt(v)

          return (
            <React.Fragment key={v.id}>
              {track.length > 1 && (
                <Polyline
                  positions={track}
                  pathOptions={{
                    color,
                    weight: isSel || isTop ? 2.5 : 1,
                    opacity: isSel || isTop ? 0.9 : 0.35,
                  }}
                  eventHandlers={{ click: () => setSelectedVessel(v.id) }}
                />
              )}
              {pos && (
                <CircleMarker
                  center={pos}
                  radius={isTop ? 8 : isSel ? 7 : 5}
                  pathOptions={{ color, fillColor: color, fillOpacity: 0.95, weight: 2 }}
                  eventHandlers={{ click: () => setSelectedVessel(v.id) }}
                >
                  <Tooltip>
                    #{v.rank} {v.name} — {v.correlation_score?.toFixed(4)}
                  </Tooltip>
                </CircleMarker>
              )}
            </React.Fragment>
          )
        })}
      </MapContainer>

      <div className="absolute bottom-3 right-3 z-[400] rounded bg-slate-950/85 border border-slate-700 px-3 py-2 text-[11px] space-y-1">
        <Legend color="#f59e0b" label="Detected spill polygon" />
        <Legend color="#7FE7D6" label="Probable origin / drift" />
        <Legend color="#fbbf24" label="Top candidate vessel" />
        <Legend color="#64748b" label="Other vessels" />
      </div>
    </div>
  )
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-2 text-slate-300">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </div>
  )
}
