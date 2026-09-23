import React, { useMemo, useRef, useEffect, useState, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, Html } from '@react-three/drei'
import * as THREE from 'three'
import useInvestigationStore from '../../context/investigationStore'

/**
 * 3D drift + vessel time-lapse.
 *
 * All geometry is derived from the investigation record: the spill shape
 * is the model's predicted polygon, the particles are the drift
 * simulation's actual particle positions, and the vessels follow their
 * real AIS trajectories. Nothing here is independently invented.
 *
 * Geographic coordinates are projected to a local east/north kilometre
 * plane centred on the spill so the scene sits near the origin, which
 * keeps float precision well-behaved.
 */

const KM_PER_DEG_LAT = 110.574
const kmPerDegLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180)

function useProjector(centreLat, centreLon) {
  return useMemo(() => {
    const kLon = kmPerDegLon(centreLat || 0)
    return (lon, lat) => [
      (lon - centreLon) * kLon,
      (lat - centreLat) * KM_PER_DEG_LAT,
    ]
  }, [centreLat, centreLon])
}

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */

function Ocean() {
  const ref = useRef()
  const geometry = useMemo(() => new THREE.PlaneGeometry(220, 220, 72, 72), [])
  const base = useRef(null)

  useEffect(() => {
    base.current = Float32Array.from(geometry.attributes.position.array)
    return () => geometry.dispose()
  }, [geometry])

  useFrame(({ clock }) => {
    if (!ref.current || !base.current) return
    const t = clock.getElapsedTime()
    const pos = ref.current.geometry.attributes.position
    const arr = pos.array
    const src = base.current
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] =
        Math.sin(src[i] * 0.12 + t * 0.45) * 0.16 +
        Math.cos(src[i + 1] * 0.09 - t * 0.3) * 0.12
    }
    pos.needsUpdate = true
  })

  return (
    <mesh ref={ref} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]}>
      <meshStandardMaterial
        color="#0c2b3d" roughness={0.38} metalness={0.55}
        transparent opacity={0.94}
      />
    </mesh>
  )
}

function SpillSurface({ points }) {
  const ref = useRef()

  const geometry = useMemo(() => {
    if (!points || points.length < 3) return null
    const shape = new THREE.Shape()
    shape.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1])
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [points])

  useEffect(() => () => geometry?.dispose(), [geometry])

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.material.opacity = 0.55 + Math.sin(clock.getElapsedTime() * 1.6) * 0.12
    }
  })

  if (!geometry) return null
  return (
    <mesh ref={ref} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
      <meshBasicMaterial color="#f59e0b" transparent opacity={0.6} side={THREE.DoubleSide} />
    </mesh>
  )
}

function OriginMarker({ position, radiusKm }) {
  const pulse = useRef()
  useFrame(({ clock }) => {
    if (pulse.current) {
      const s = 1 + Math.sin(clock.getElapsedTime() * 2) * 0.22
      pulse.current.scale.set(s, 1, s)
    }
  })

  return (
    <group position={[position[0], 0, position[1]]}>
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.55, 24, 24]} />
        <meshBasicMaterial color="#7FE7D6" />
      </mesh>
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 6, 12]} />
        <meshBasicMaterial color="#7FE7D6" transparent opacity={0.28} />
      </mesh>
      <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[Math.max(radiusKm - 0.15, 0.1), radiusKm, 64]} />
        <meshBasicMaterial color="#7FE7D6" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      <pointLight color="#7FE7D6" intensity={3} distance={26} />
      <Html distanceFactor={90} position={[0, 7, 0]}>
        <div className="px-2 py-0.5 rounded bg-slate-950/85 border border-teal-400/40 text-teal-300 text-[10px] font-semibold whitespace-nowrap">
          PROBABLE ORIGIN
        </div>
      </Html>
    </group>
  )
}

/** Oil particles taken straight from the drift simulation frames. */
function DriftParticles({ frames, project, frameIndex }) {
  const ref = useRef()
  const count = frames?.[0]?.particles?.length ?? 0

  const positions = useMemo(() => new Float32Array(Math.max(count, 1) * 3), [count])

  useFrame(() => {
    if (!ref.current || !frames?.length) return
    const frame = frames[Math.min(frameIndex, frames.length - 1)]
    if (!frame?.particles) return
    const arr = ref.current.geometry.attributes.position.array
    for (let i = 0; i < frame.particles.length; i += 1) {
      const [lon, lat] = frame.particles[i]
      const [x, z] = project(lon, lat)
      arr[i * 3] = x
      arr[i * 3 + 1] = 0.25
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
      <pointsMaterial color="#ff9f1c" size={0.5} transparent opacity={0.8} sizeAttenuation />
    </points>
  )
}

function DriftCorridor({ path, project }) {
  const geometry = useMemo(() => {
    if (!path || path.length < 2) return null
    const pts = path.map((p) => {
      const [x, z] = project(p.lon, p.lat)
      return new THREE.Vector3(x, 0.2, z)
    })
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [path, project])

  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="#7FE7D6" transparent opacity={0.75} />
    </line>
  )
}

function VesselTrack({ vessel, project, isSelected, isTop, onSelect, currentDate }) {
  const markerRef = useRef()
  const color = isTop ? '#fbbf24' : isSelected ? '#3BA7F2' : '#64748b'

  const geometry = useMemo(() => {
    const traj = vessel.trajectory ?? []
    if (traj.length < 2) return null
    const pts = traj.map((p) => {
      const [x, z] = project(p.lon, p.lat)
      return new THREE.Vector3(x, 0.12, z)
    })
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [vessel.trajectory, project])

  useEffect(() => () => geometry?.dispose(), [geometry])

  useFrame(() => {
    if (!markerRef.current || !currentDate) return
    const traj = vessel.trajectory ?? []
    if (!traj.length) return

    const t = currentDate.getTime()
    let lon = traj[traj.length - 1].lon
    let lat = traj[traj.length - 1].lat
    let heading = traj[traj.length - 1].heading ?? 0

    if (t <= new Date(traj[0].time).getTime()) {
      lon = traj[0].lon; lat = traj[0].lat; heading = traj[0].heading ?? 0
    } else {
      for (let i = 0; i < traj.length - 1; i += 1) {
        const t0 = new Date(traj[i].time).getTime()
        const t1 = new Date(traj[i + 1].time).getTime()
        if (t >= t0 && t <= t1) {
          const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
          lon = traj[i].lon + f * (traj[i + 1].lon - traj[i].lon)
          lat = traj[i].lat + f * (traj[i + 1].lat - traj[i].lat)
          heading = traj[i].heading ?? 0
          break
        }
      }
    }

    const [x, z] = project(lon, lat)
    markerRef.current.position.set(x, 0.45, z)
    markerRef.current.rotation.y = -(heading * Math.PI) / 180
    const target = isTop ? 1.5 : isSelected ? 1.25 : 1
    markerRef.current.scale.lerp(new THREE.Vector3(target, target, target), 0.12)
  })

  return (
    <group>
      {geometry && (
        <line geometry={geometry}>
          <lineBasicMaterial
            color={color}
            transparent
            opacity={isSelected || isTop ? 0.85 : 0.22}
          />
        </line>
      )}
      <group
        ref={markerRef}
        onClick={(e) => { e.stopPropagation(); onSelect(vessel.id) }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'auto')}
      >
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.45, 1.4, 6]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={isTop ? 0.75 : isSelected ? 0.5 : 0.15}
          />
        </mesh>
        {(isTop || isSelected) && (
          <Html distanceFactor={110} position={[0, 2.2, 0]}>
            <div
              className="px-1.5 py-0.5 rounded bg-slate-950/85 text-[9px] font-semibold whitespace-nowrap border"
              style={{ color, borderColor: `${color}66` }}
            >
              #{vessel.rank} {vessel.name}
            </div>
          </Html>
        )}
      </group>
    </group>
  )
}

function VectorArrow({ position, directionDeg, color, label, length = 6 }) {
  const rad = (directionDeg * Math.PI) / 180
  return (
    <group
      position={[position[0], 1.2, position[1]]}
      rotation={[0, -rad, 0]}
    >
      <mesh position={[0, 0, length / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, length, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 0, length]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.3, 0.9, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html distanceFactor={130} position={[0, 0.9, length]}>
        <div className="text-[9px] font-semibold whitespace-nowrap" style={{ color }}>
          {label}
        </div>
      </Html>
    </group>
  )
}

function CameraRig({ focus }) {
  const { camera, controls } = useThree()
  const target = useRef(new THREE.Vector3(0, 0, 0))

  useEffect(() => {
    if (focus) target.current.set(focus[0], 0, focus[1])
  }, [focus])

  useFrame(() => {
    if (controls?.target) {
      controls.target.lerp(target.current, 0.06)
      controls.update()
    }
  })
  return null
}

/* ------------------------------------------------------------------ */

export default function SpillScene3D({ investigation }) {
  const {
    selectedVesselId, setSelectedVessel, simulationTime,
  } = useInvestigationStore()
  const [webgl] = useState(() => hasWebGL())

  const spill = investigation?.spill ?? {}
  const origin = investigation?.origin?.origin ?? {}
  const drift = investigation?.drift ?? {}
  const vessels = investigation?.ranking?.vessels ?? []
  const sim = investigation?.simulation ?? {}

  const centre = spill.centroid ?? { lat: origin.lat ?? 0, lon: origin.lon ?? 0 }
  const project = useProjector(centre.lat, centre.lon)

  const spillPoints = useMemo(
    () => (spill.polygon ?? []).map(([lon, lat]) => project(lon, lat)),
    [spill.polygon, project],
  )
  const originXZ = useMemo(
    () => (origin.lat !== undefined ? project(origin.lon, origin.lat) : [0, 0]),
    [origin.lat, origin.lon, project],
  )

  const frames = drift.frames ?? []

  const currentDate = useMemo(() => {
    if (!sim.start_time) return null
    return new Date(new Date(sim.start_time).getTime() + simulationTime * 60000)
  }, [sim.start_time, simulationTime])

  // Frames cover release -> detection, which starts later than the timeline
  // (the timeline opens when the release WINDOW opens). Selecting by
  // timestamp rather than by proportion keeps the particles locked to the
  // same clock as the vessels instead of drifting a few hours ahead.
  const frameTimes = useMemo(
    () => frames.map((f) => new Date(f.time).getTime()),
    [frames],
  )

  const frameIndex = useMemo(() => {
    if (!frameTimes.length || !currentDate) return 0
    const t = currentDate.getTime()
    if (t <= frameTimes[0]) return 0
    if (t >= frameTimes[frameTimes.length - 1]) return frameTimes.length - 1
    let lo = 0
    let hi = frameTimes.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (frameTimes[mid] <= t) lo = mid
      else hi = mid
    }
    return lo
  }, [frameTimes, currentDate])

  const focus = useMemo(() => {
    const sel = vessels.find((v) => v.id === selectedVesselId)
    if (!sel?.trajectory?.length) return [0, 0]
    const p = sel.trajectory[Math.floor(sel.trajectory.length / 2)]
    return project(p.lon, p.lat)
  }, [selectedVesselId, vessels, project])

  if (!webgl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-slate-300 font-semibold">WebGL unavailable</p>
        <p className="text-slate-500 text-sm max-w-sm">
          This browser or GPU cannot render the 3D scene. Switch to the 2D Map
          view — it shows the same investigation data.
        </p>
      </div>
    )
  }

  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [45, 38, 45], fov: 55 }}>
      <Suspense fallback={null}>
        <color attach="background" args={['#050c14']} />
        <fog attach="fog" args={['#07131d', 70, 260]} />

        <ambientLight intensity={0.55} />
        <directionalLight position={[60, 80, 40]} intensity={1.05} />
        <pointLight position={[-50, 40, -40]} intensity={0.35} color="#3BA7F2" />

        <Ocean />
        <Grid
          args={[220, 220]}
          cellSize={5}
          cellColor="#15364a"
          sectionSize={25}
          sectionColor="#1e4c66"
          fadeDistance={190}
          fadeStrength={1.2}
          position={[0, -0.35, 0]}
          infiniteGrid={false}
        />

        <SpillSurface points={spillPoints} />
        {origin.lat !== undefined && (
          <OriginMarker
            position={originXZ}
            radiusKm={origin.uncertainty_radius_km ?? 1}
          />
        )}
        <DriftCorridor path={drift.path} project={project} />
        <DriftParticles frames={frames} project={project} frameIndex={frameIndex} />

        {drift.environment && (
          <>
            <VectorArrow
              position={[originXZ[0] - 14, originXZ[1] - 14]}
              directionDeg={drift.environment.current_direction_deg}
              color="#3BA7F2"
              label={`Current ${drift.environment.current_speed_ms?.toFixed(2)} m/s`}
            />
            <VectorArrow
              position={[originXZ[0] - 14, originXZ[1] - 22]}
              directionDeg={drift.environment.wind_direction_deg}
              color="#7FE7D6"
              label={`Wind ${drift.environment.wind_speed_ms?.toFixed(1)} m/s`}
            />
          </>
        )}

        {vessels.map((v) => (
          <VesselTrack
            key={v.id}
            vessel={v}
            project={project}
            isSelected={v.id === selectedVesselId}
            isTop={v.rank === 1}
            onSelect={setSelectedVessel}
            currentDate={currentDate}
          />
        ))}

        <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.1} />
        <CameraRig focus={focus} />
      </Suspense>
    </Canvas>
  )
}
