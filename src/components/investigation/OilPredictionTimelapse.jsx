import React, {
  useCallback, useEffect, useMemo, useRef, useState, Suspense,
} from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { Play, Pause, RotateCcw, Crosshair } from 'lucide-react'
import useThemeStore from '../../context/themeStore'
import { createBlobTexture, createOceanMaterial } from '../three/ocean'

/** Scene palette, mirrored from the main 3D view so both stay in step. */
const PAL = {
  dark: {
    bg: '#04121d', fog: '#062131', fogNear: 55, fogFar: 200,
    deep: '#042a46', mid: '#0B6FA4', shallow: '#1288b8', foam: '#63E6D5',
    sunStrength: 0.38, ambient: 0.5, dir: 0.85,
    grid: '#0f3145', gridSection: '#16465e',
    oil: '#2b1d0e', oilRim: '#6b4a1f',
    predicted: '#38bdf8', observed: '#e08a1e', origin: '#63E6D5',
  },
  light: {
    bg: '#dceefa', fog: '#cfe6f2', fogNear: 70, fogFar: 240,
    deep: '#0b5c8f', mid: '#168AC4', shallow: '#57bfe4', foam: '#d8f4ef',
    sunStrength: 0.55, ambient: 0.75, dir: 1.0,
    grid: '#9dc6dd', gridSection: '#7fb3d0',
    oil: '#2a1c0d', oilRim: '#7a5622',
    predicted: '#0369a1', observed: '#b45309', origin: '#0d9488',
  },
}

/**
 * Oil Spill Prediction Time-Lapse  (ADDITIVE FEATURE)
 *
 * Shows how the slick is predicted to travel from the probable origin to
 * the observed spill area.
 *
 * Data source: the EXISTING investigation record only --
 *   investigation.drift.frames[]   real particle positions per timestep
 *   investigation.drift.path[]     drift centroid track
 *   investigation.origin.origin    probable origin + uncertainty
 *   investigation.spill.polygon    observed spill polygon
 * No backend call is made and no existing value is recomputed.
 *
 * This component deliberately keeps its OWN clock in local state rather
 * than using the shared investigation store, because that store's
 * simulationTime drives the existing vessel time-lapse. Sharing it would
 * change existing behaviour.
 */

const SPEEDS = [0.5, 1, 2]
const PARTICLE_CAP = 500      // frames already ship 500; cap guards larger runs
const KM_PER_DEG_LAT = 110.574

/* ---------------- geometry helpers (local, self-contained) ---------- */

const kmPerDegLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180)

function makeProjector(lat0, lon0) {
  const kLon = kmPerDegLon(lat0 || 0)
  return (lon, lat) => [(lon - lon0) * kLon, (lat - lat0) * KM_PER_DEG_LAT]
}

function haversineKm(lon1, lat1, lon2, lat2) {
  const R = 6371.0088
  const toRad = (d) => (d * Math.PI) / 180
  const p1 = toRad(lat1)
  const p2 = toRad(lat2)
  const dp = p2 - p1
  const dl = toRad(lon2 - lon1)
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Andrew's monotone chain convex hull. Input/output: [[x,y], ...] */
function convexHull(points) {
  if (points.length < 3) return points.slice()
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Shoelace area, input in km. */
function polygonAreaKm2(poly) {
  if (!poly || poly.length < 3) return 0
  let a = 0
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/** Sutherland-Hodgman. `clip` must be convex (a convex hull here). */
function clipPolygon(subject, clip) {
  if (!subject?.length || !clip?.length) return []
  let output = subject.slice()

  for (let i = 0; i < clip.length; i += 1) {
    const A = clip[i]
    const B = clip[(i + 1) % clip.length]
    const input = output
    output = []
    if (!input.length) break

    const side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0])
    const intersect = (p, q) => {
      const d = side(p) - side(q)
      if (Math.abs(d) < 1e-12) return q
      const t = side(p) / d
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]
    }

    for (let j = 0; j < input.length; j += 1) {
      const cur = input[j]
      const prev = input[(j + input.length - 1) % input.length]
      const curIn = side(cur) >= 0
      const prevIn = side(prev) >= 0
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur))
        output.push(cur)
      } else if (prevIn) {
        output.push(intersect(prev, cur))
      }
    }
  }
  return output
}

/* ---------------- 3D pieces ----------------------------------------- */

function Ocean({ pal }) {
  const meshRef = useRef()
  const geom = useMemo(() => new THREE.PlaneGeometry(200, 200, 110, 110), [])
  const mat = useMemo(
    () =>
      createOceanMaterial({
        deep: pal.deep,
        mid: pal.mid,
        shallow: pal.shallow,
        foam: pal.foam,
        sunStrength: pal.sunStrength,
        amplitude: 0.7,
      }),
    [pal],
  )
  useEffect(() => () => { geom.dispose(); mat.dispose() }, [geom, mat])
  useFrame(({ clock }) => { mat.uniforms.uTime.value = clock.getElapsedTime() })

  return (
    <mesh
      ref={meshRef}
      geometry={geom}
      material={mat}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.35, 0]}
    />
  )
}

function OriginMarker({ xz, radiusKm, pal }) {
  const ring = useRef()
  useFrame(({ clock }) => {
    if (ring.current) {
      const p = (clock.getElapsedTime() * 0.45) % 1
      const s = 0.45 + p * 1.05
      ring.current.scale.set(s, 1, s)
      ring.current.material.opacity = (1 - p) * 0.4
    }
  })
  return (
    <group position={[xz[0], 0, xz[1]]}>
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.42, 20, 20]} />
        <meshBasicMaterial color={pal.origin} />
      </mesh>
      <mesh position={[0, 2.2, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 4.2, 10]} />
        <meshBasicMaterial color={pal.origin} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[Math.max(radiusKm - 0.18, 0.1), radiusKm, 56]} />
        <meshBasicMaterial color={pal.origin} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <pointLight color={pal.origin} intensity={2} distance={22} />
    </group>
  )
}

/** Oil particles, interpolated between the two bracketing drift frames. */
function OilParticles({ frames, project, progressRef, pal }) {
  const ref = useRef()
  const count = Math.min(frames[0]?.particles?.length ?? 0, PARTICLE_CAP)
  const positions = useMemo(() => new Float32Array(Math.max(count, 1) * 3), [count])
  const texture = useMemo(() => createBlobTexture(64), [])
  useEffect(() => () => texture.dispose(), [texture])

  useFrame(() => {
    if (!ref.current || !count) return
    const p = progressRef.current
    const maxIdx = frames.length - 1
    const f = Math.min(maxIdx, Math.max(0, p * maxIdx))
    const i0 = Math.floor(f)
    const i1 = Math.min(maxIdx, i0 + 1)
    const frac = f - i0

    const a = frames[i0]?.particles
    const b = frames[i1]?.particles
    if (!a) return

    const arr = ref.current.geometry.attributes.position.array
    for (let i = 0; i < count; i += 1) {
      const pa = a[i]
      if (!pa) continue
      const pb = b?.[i] ?? pa
      const lon = pa[0] + (pb[0] - pa[0]) * frac
      const lat = pa[1] + (pb[1] - pa[1]) * frac
      const [x, z] = project(lon, lat)
      arr[i * 3] = x
      arr[i * 3 + 1] = 0.3
      arr[i * 3 + 2] = z
    }
    ref.current.geometry.attributes.position.needsUpdate = true
  })

  if (!count) return null
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        map={texture}
        color={pal.oil}
        size={1.1}
        transparent
        opacity={0.8}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  )
}

/** Predicted extent = convex hull of the current frame's particles. */
function PredictedRegion({ hullXZ, pal }) {
  const geom = useMemo(() => {
    if (!hullXZ || hullXZ.length < 3) return null
    const shape = new THREE.Shape()
    shape.moveTo(hullXZ[0][0], hullXZ[0][1])
    for (let i = 1; i < hullXZ.length; i += 1) shape.lineTo(hullXZ[i][0], hullXZ[i][1])
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [hullXZ])

  useEffect(() => () => geom?.dispose(), [geom])
  if (!geom) return null
  return (
    <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
      <meshBasicMaterial color={pal.predicted} transparent opacity={0.34} side={THREE.DoubleSide} />
    </mesh>
  )
}

function ObservedRegion({ polyXZ, pal }) {
  const geom = useMemo(() => {
    if (!polyXZ || polyXZ.length < 3) return null
    const shape = new THREE.Shape()
    shape.moveTo(polyXZ[0][0], polyXZ[0][1])
    for (let i = 1; i < polyXZ.length; i += 1) shape.lineTo(polyXZ[i][0], polyXZ[i][1])
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [polyXZ])

  useEffect(() => () => geom?.dispose(), [geom])
  if (!geom) return null
  return (
    <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
      <meshBasicMaterial color={pal.oil} transparent opacity={0.55} side={THREE.DoubleSide} />
    </mesh>
  )
}

function DriftCorridor({ pathXZ, pal }) {
  const geom = useMemo(() => {
    if (!pathXZ || pathXZ.length < 2) return null
    return new THREE.BufferGeometry().setFromPoints(
      pathXZ.map(([x, z]) => new THREE.Vector3(x, 0.22, z)),
    )
  }, [pathXZ])
  useEffect(() => () => geom?.dispose(), [geom])
  if (!geom) return null
  return (
    <line geometry={geom}>
      <lineBasicMaterial color={pal.origin} transparent opacity={0.6} />
    </line>
  )
}

/* ---------------- main component ------------------------------------ */

export default function OilPredictionTimelapse({ investigation }) {
  const { isDark } = useThemeStore()
  const pal = isDark ? PAL.dark : PAL.light

  const drift = investigation?.drift
  const originObj = investigation?.origin?.origin
  const spill = investigation?.spill

  const frames = drift?.frames ?? []
  const hasFrames = frames.length >= 2 && (frames[0]?.particles?.length ?? 0) > 0
  const hasEndpoints =
    originObj?.lat !== undefined && spill?.centroid?.lat !== undefined

  // ---- own clock (independent of the vessel time-lapse) -------------
  const [progress, setProgress] = useState(0)   // 0..1
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [direction, setDirection] = useState('forecast')

  const progressRef = useRef(0)
  const rafRef = useRef(null)
  const lastRef = useRef(0)
  const hostRef = useRef(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => { progressRef.current = progress }, [progress])

  // Pause the render loop when scrolled out of view.
  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { threshold: 0.05 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!playing || !hasFrames) return undefined
    lastRef.current = performance.now()
    const SPAN_SEC = 20 // one full pass at 1x

    const tick = (now) => {
      const dt = (now - lastRef.current) / 1000
      lastRef.current = now
      const next = progressRef.current + (dt * speed) / SPAN_SEC
      if (next >= 1) {
        progressRef.current = 1
        setProgress(1)
        setPlaying(false)
        return
      }
      progressRef.current = next
      setProgress(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [playing, speed, hasFrames])

  // ---- projection + static geometry ---------------------------------
  const centre = spill?.centroid ?? { lat: originObj?.lat ?? 0, lon: originObj?.lon ?? 0 }
  const project = useMemo(
    () => makeProjector(centre.lat, centre.lon),
    [centre.lat, centre.lon],
  )

  const originXZ = useMemo(
    () => (originObj ? project(originObj.lon, originObj.lat) : [0, 0]),
    [originObj, project],
  )
  const pathXZ = useMemo(
    () => (drift?.path ?? []).map((p) => project(p.lon, p.lat)),
    [drift?.path, project],
  )
  const observedXZ = useMemo(
    () => (spill?.polygon ?? []).map(([lon, lat]) => project(lon, lat)),
    [spill?.polygon, project],
  )

  // Effective frame index honours hindcast (reverse traversal of the
  // same trajectory -- no separate or invented simulation).
  const effProgress = direction === 'hindcast' ? 1 - progress : progress
  const effRef = useRef(effProgress)
  useEffect(() => { effRef.current = effProgress }, [effProgress])

  const frameIndex = hasFrames
    ? Math.min(frames.length - 1, Math.max(0, Math.round(effProgress * (frames.length - 1))))
    : 0
  const frame = frames[frameIndex]

  // Hull recomputed only on frame change, not every animation tick.
  const hullXZ = useMemo(() => {
    const pts = frame?.particles
    if (!pts || pts.length < 3) return null
    return convexHull(pts.map(([lon, lat]) => project(lon, lat)))
  }, [frame, project])

  // ---- live metrics, all derived from existing values ---------------
  const metrics = useMemo(() => {
    if (!hasFrames || !frame) return null
    const c = frame.centroid
    const distKm = originObj
      ? haversineKm(originObj.lon, originObj.lat, c.lon, c.lat)
      : 0
    const tCur = new Date(frame.time)
    const tStart = new Date(frames[0].time)
    const elapsedH = (tCur - tStart) / 3600000

    const out = {
      currentTime: tCur,
      startTime: tStart,
      endTime: new Date(frames[frames.length - 1].time),
      elapsedH,
      distanceKm: distKm,
      // Instantaneous speed over the elapsed span; falls back to the
      // pipeline's own figure at t=0.
      speedMs: elapsedH > 0 ? (distKm * 1000) / (elapsedH * 3600) : (drift?.drift_speed_ms ?? 0),
      spreadKm: frame.spread_km ?? 0,
      centroid: c,
      predictedAreaKm2: hullXZ ? polygonAreaKm2(hullXZ) : 0,
    }

    // Final-step comparison against the observed spill.
    const atEnd = frameIndex === frames.length - 1
    if (atEnd && observedXZ.length >= 3 && hullXZ && hullXZ.length >= 3) {
      const observedArea = polygonAreaKm2(observedXZ)
      const inter = clipPolygon(observedXZ, hullXZ)
      const interArea = polygonAreaKm2(inter)
      const union = out.predictedAreaKm2 + observedArea - interArea
      out.comparison = {
        predictedAreaKm2: out.predictedAreaKm2,
        observedAreaKm2: observedArea,
        intersectionKm2: interArea,
        iou: union > 0 ? interArea / union : 0,
        centroidOffsetKm: haversineKm(
          c.lon, c.lat, spill.centroid.lon, spill.centroid.lat,
        ),
      }
    }
    return out
  }, [hasFrames, frame, frameIndex, frames, originObj, hullXZ, observedXZ, spill, drift])

  const restart = useCallback(() => {
    progressRef.current = 0
    setProgress(0)
    setPlaying(false)
  }, [])

  /* ---------------- failsafe states -------------------------------- */

  if (!investigation || investigation.status !== 'complete') return null

  if (!hasFrames && !hasEndpoints) {
    return (
      <Shell>
        <div className="p-8 text-center">
          <p className="txt font-semibold mb-1">
            Oil drift prediction data unavailable.
          </p>
          <p className="text-sm txt-faint">
            This investigation has no drift trajectory or origin/observed
            coordinates to animate.
          </p>
        </div>
      </Shell>
    )
  }

  const demoInterpolated = !hasFrames && hasEndpoints

  return (
    <Shell
      badge={
        demoInterpolated
          ? { text: 'Demo Prediction', tone: 'purple' }
          : { text: direction === 'hindcast' ? 'Hindcast' : 'Forecast', tone: 'sky' }
      }
      right={
        <div className="flex rounded-md border bd overflow-hidden">
          {['forecast', 'hindcast'].map((d) => (
            <button
              key={d}
              onClick={() => { setDirection(d); restart() }}
              className={`px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
                direction === d
                  ? 'bg-sky-600 txt'
                  : 'surface-2 txt-muted'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      }
    >
      <div ref={hostRef} className="grid grid-cols-1 xl:grid-cols-[1fr_300px]">
        {/* ---- 3D panel ---- */}
        <div className="relative h-[340px] border-b xl:border-b-0 xl:border-r bd">
          {demoInterpolated ? (
            <div className="h-full flex items-center justify-center p-6 text-center">
              <p className="text-sm txt-muted">
                Only origin and observed coordinates are present. A deterministic
                interpolated preview is shown in the metrics panel.
              </p>
            </div>
          ) : (
            <Canvas
              dpr={[1, 1.6]}
              camera={{ position: [38, 34, 38], fov: 52 }}
              frameloop={visible ? 'always' : 'demand'}
            >
              <Suspense fallback={null}>
                <color attach="background" args={[pal.bg]} />
                <fog attach="fog" args={[pal.fog, pal.fogNear, pal.fogFar]} />
                <ambientLight intensity={pal.ambient} />
                <directionalLight position={[40, 60, 30]} intensity={pal.dir} color="#fff6e8" />

                <Ocean />
                <Grid
                  args={[160, 160]}
                  cellSize={5}
                  cellColor={pal.grid}
                  sectionSize={20}
                  sectionColor={pal.gridSection}
                  fadeDistance={150}
                  fadeStrength={1.2}
                  position={[0, -0.3, 0]}
                  infiniteGrid={false}
                />

                <DriftCorridor pathXZ={pathXZ} pal={pal} />
                <ObservedRegion polyXZ={observedXZ} pal={pal} />
                <PredictedRegion hullXZ={hullXZ} pal={pal} />
                <OilParticles frames={frames} project={project} progressRef={effRef} pal={pal} />
                {originObj && (
                  <OriginMarker
                    xz={originXZ}
                    radiusKm={originObj.uncertainty_radius_km ?? 1}
                    pal={pal}
                  />
                )}

                <OrbitControls enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.1} />
              </Suspense>
            </Canvas>
          )}

          <div className="absolute bottom-2 left-2 rounded surface border bd px-2.5 py-1.5 text-[10px] space-y-1 pointer-events-none">
            <LegendRow color={pal.origin} label="Probable origin / drift" />
            <LegendRow color={pal.oil} label="Predicted oil particles" />
            <LegendRow color={pal.predicted} label="Predicted spill extent" />
            <LegendRow color={pal.observed} label="Observed spill" />
          </div>
        </div>

        {/* ---- metrics ---- */}
        <div className="p-4 space-y-3">
          <MetricGroup title="Prediction state">
            <Metric
              label="Probable origin"
              value={originObj ? `${originObj.lat.toFixed(3)}°, ${originObj.lon.toFixed(3)}°` : '—'}
            />
            <Metric
              label="Predicted position"
              value={metrics?.centroid
                ? `${metrics.centroid.lat.toFixed(3)}°, ${metrics.centroid.lon.toFixed(3)}°`
                : '—'}
            />
            <Metric label="Distance travelled" value={metrics ? `${metrics.distanceKm.toFixed(2)} km` : '—'} />
            <Metric label="Drift speed" value={metrics ? `${metrics.speedMs.toFixed(3)} m/s` : '—'} />
            <Metric
              label="Drift direction"
              value={drift?.drift_direction_deg !== undefined
                ? `${drift.drift_direction_deg.toFixed(0)}°` : '—'}
            />
            <Metric label="Spread (1σ)" value={metrics ? `${metrics.spreadKm.toFixed(2)} km` : '—'} />
            <Metric
              label="Predicted extent"
              value={metrics?.predictedAreaKm2
                ? `${metrics.predictedAreaKm2.toFixed(2)} km²` : '—'}
            />
          </MetricGroup>

          <MetricGroup title="Simulation time">
            <Metric
              label="Current"
              value={metrics ? metrics.currentTime.toISOString().slice(11, 16) + ' UTC' : '—'}
            />
            <Metric
              label="Start"
              value={metrics ? metrics.startTime.toISOString().slice(11, 16) + ' UTC' : '—'}
            />
            <Metric
              label="End"
              value={metrics ? metrics.endTime.toISOString().slice(11, 16) + ' UTC' : '—'}
            />
            <Metric label="Elapsed" value={metrics ? `T+${metrics.elapsedH.toFixed(1)} h` : '—'} />
          </MetricGroup>

          {metrics?.comparison ? (
            <MetricGroup title="Predicted vs observed" accent>
              <Metric label="Predicted area" value={`${metrics.comparison.predictedAreaKm2.toFixed(2)} km²`} />
              <Metric label="Observed area" value={`${metrics.comparison.observedAreaKm2.toFixed(2)} km²`} />
              <Metric label="Overlap" value={`${metrics.comparison.intersectionKm2.toFixed(2)} km²`} />
              <Metric label="IoU" value={metrics.comparison.iou.toFixed(3)} />
              <Metric label="Centroid offset" value={`${metrics.comparison.centroidOffsetKm.toFixed(2)} km`} />
              <p className="pt-1.5 text-[10px] leading-snug txt-faint">
                Predicted extent is the convex hull of the drift particles, so
                overlap and IoU are approximate.
              </p>
            </MetricGroup>
          ) : (
            <p className="text-[11px] txt-faint leading-snug">
              Run to the final timestep to compare the predicted extent against
              the observed spill.
            </p>
          )}
        </div>
      </div>

      {/* ---- controls ---- */}
      <div className="border-t bd surface-2 px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={restart}
            title="Restart"
            className="p-2 rounded-lg surface-2 row-hover txt transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            disabled={!hasFrames}
            title={playing ? 'Pause' : 'Play'}
            className="btn btn-accent"
            style={{ padding: '0.45rem 0.6rem' }}
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={progress}
            disabled={!hasFrames}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              progressRef.current = v
              setProgress(v)
            }}
            aria-label="Oil prediction timeline"
            className="flex-1 min-w-[160px] h-1.5 rounded-full appearance-none cursor-pointer accent-sky-500"
            style={{
              background: `linear-gradient(to right, var(--info) 0%, var(--info) ${progress * 100}%, var(--border) ${progress * 100}%, var(--border) 100%)`,
            }}
          />

          <div className="flex items-center gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                  speed === s
                    ? 'bg-sky-600 txt'
                    : 'surface-2 txt-muted'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          <span className="text-[11px] font-mono txt-faint flex items-center gap-1.5">
            <Crosshair className="w-3 h-3" />
            step {frameIndex + 1}/{frames.length || 1}
          </span>
        </div>
      </div>
    </Shell>
  )
}

/* ---------------- small presentational helpers ---------------------- */

function Shell({ children, badge, right }) {
  const tone = badge?.tone === 'purple'
    ? 'bg-purple-500/20 text-purple-300'
    : 'bg-sky-500/20 text-sky-300'
  return (
    <section className="mt-4 rounded-lg border bd surface overflow-hidden">
      <div className="px-4 py-3 border-b bd flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold txt">Oil Spill Prediction Time-Lapse</h2>
          {badge && (
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${tone}`}>
              {badge.text}
            </span>
          )}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function LegendRow({ color, label }) {
  return (
    <div className="flex items-center gap-2 txt">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </div>
  )
}

function MetricGroup({ title, children, accent }) {
  return (
    <div className={accent ? 'p-2.5 rounded border border-sky-500/30 bg-sky-500/5' : ''}>
      <p className="text-[10px] uppercase tracking-wider txt-faint mb-1.5">{title}</p>
      <dl className="space-y-1">{children}</dl>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-[12px]">
      <dt className="txt-muted">{label}</dt>
      <dd className="txt font-mono text-[11.5px] text-right">{value}</dd>
    </div>
  )
}
