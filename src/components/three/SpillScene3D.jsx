import React, { useMemo, useRef, useEffect, useState, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, Html } from '@react-three/drei'
import * as THREE from 'three'
import useInvestigationStore from '../../context/investigationStore'
import useThemeStore from '../../context/themeStore'
import {
  createBlobTexture,
  createHullGeometry,
  createOceanMaterial,
  createWakeGeometry,
  createWakeMaterial,
} from './ocean'

/**
 * 3D drift + vessel time-lapse.
 *
 * All geometry comes from the investigation record: the spill shape is
 * the model's predicted polygon, particles are the drift simulation's
 * own particle positions, vessels follow their real AIS trajectories.
 * The rendering below is presentation only -- no position, time or
 * scientific value is recomputed here.
 *
 * Geographic coordinates project to a local east/north kilometre plane
 * centred on the spill, keeping float precision well-behaved.
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

/** Theme-driven scene palette. */
const PALETTE = {
  dark: {
    bg: '#04121d',
    fog: '#062131',
    fogNear: 70,
    fogFar: 260,
    deep: '#042a46',
    mid: '#0B6FA4',
    shallow: '#1288b8',
    foam: '#63E6D5',
    sunStrength: 0.38,
    ambient: 0.45,
    dirLight: 0.85,
    gridCell: '#0f3145',
    gridSection: '#16465e',
    gridOpacity: 0.35,
    oil: '#2b1d0e',
    oilRim: '#6b4a1f',
    observed: '#e08a1e',
    origin: '#63E6D5',
    flow: '#8fd8ef',
    topVessel: '#fbbf24',
    vessel: '#9fb4c4',
    label: 'rgba(8,20,30,0.88)',
  },
  light: {
    bg: '#dceefa',
    fog: '#cfe6f2',
    fogNear: 90,
    fogFar: 300,
    deep: '#0b5c8f',
    mid: '#168AC4',
    shallow: '#57bfe4',
    foam: '#d8f4ef',
    sunStrength: 0.55,
    ambient: 0.7,
    dirLight: 1.0,
    gridCell: '#9dc6dd',
    gridSection: '#7fb3d0',
    gridOpacity: 0.28,
    oil: '#2a1c0d',
    oilRim: '#7a5622',
    observed: '#b45309',
    origin: '#0d9488',
    flow: '#0b6fa4',
    topVessel: '#b45309',
    vessel: '#4a6274',
    label: 'rgba(255,255,255,0.92)',
  },
}

/* ------------------------------------------------------------------ */
/* Ocean                                                               */

function Ocean({ pal, currentDirDeg }) {
  const meshRef = useRef()
  const geometry = useMemo(() => new THREE.PlaneGeometry(280, 280, 150, 150), [])

  const material = useMemo(() => {
    const rad = ((currentDirDeg ?? 145) * Math.PI) / 180
    return createOceanMaterial({
      deep: pal.deep,
      mid: pal.mid,
      shallow: pal.shallow,
      foam: pal.foam,
      sunStrength: pal.sunStrength,
      amplitude: 0.85,
      direction: [Math.sin(rad), Math.cos(rad)],
    })
  }, [pal, currentDirDeg])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime()
  })

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.5, 0]}
      renderOrder={0}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Oil                                                                 */

const oilVert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (150.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`

const oilFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec3 uRim;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  if (t.a < 0.02) discard;
  // Slightly warmer at the blob edge: a thin sheen ring, like a real film.
  float edge = smoothstep(0.35, 0.95, 1.0 - t.a);
  vec3 col = mix(uColor, uRim, edge * 0.55);
  gl_FragColor = vec4(col, t.a * vAlpha);
}
`

/**
 * Oil as a dark translucent film. Particle positions are interpolated
 * between the two bracketing drift frames so the slick deforms with the
 * simulation instead of sliding as a rigid shape.
 */
function OilSlick({ frames, project, frameIndexRef, pal }) {
  const ref = useRef()
  const count = frames?.[0]?.particles?.length ?? 0
  const texture = useMemo(() => createBlobTexture(64), [])

  const { positions, sizes, alphas } = useMemo(() => {
    const n = Math.max(count, 1)
    const p = new Float32Array(n * 3)
    const s = new Float32Array(n)
    const a = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      // Deterministic spread of sizes/opacities: thicker core blobs,
      // thinner sheen at the fringes. Hash on index, no RNG.
      const h = (Math.sin(i * 12.9898) * 43758.5453) % 1
      const r = Math.abs(h)
      s[i] = 0.55 + r * 1.5
      a[i] = 0.35 + r * 0.5
    }
    return { positions: p, sizes: s, alphas: a }
  }, [count])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: oilVert,
        fragmentShader: oilFrag,
        uniforms: {
          uMap: { value: texture },
          uColor: { value: new THREE.Color(pal.oil) },
          uRim: { value: new THREE.Color(pal.oilRim) },
        },
        transparent: true,
        depthWrite: false,
      }),
    [texture, pal.oil, pal.oilRim],
  )

  useEffect(() => () => { material.dispose(); texture.dispose() }, [material, texture])

  useFrame(() => {
    if (!ref.current || !count || !frames?.length) return
    const f = frameIndexRef.current
    const maxIdx = frames.length - 1
    const i0 = Math.min(maxIdx, Math.max(0, Math.floor(f)))
    const i1 = Math.min(maxIdx, i0 + 1)
    const frac = f - i0

    const A = frames[i0]?.particles
    const B = frames[i1]?.particles
    if (!A) return

    const arr = ref.current.geometry.attributes.position.array
    for (let i = 0; i < count; i += 1) {
      const pa = A[i]
      if (!pa) continue
      const pb = B?.[i] ?? pa
      const lon = pa[0] + (pb[0] - pa[0]) * frac
      const lat = pa[1] + (pb[1] - pa[1]) * frac
      const [x, z] = project(lon, lat)
      arr[i * 3] = x
      arr[i * 3 + 1] = 0.12
      arr[i * 3 + 2] = z
    }
    ref.current.geometry.attributes.position.needsUpdate = true
  })

  if (!count) return null
  return (
    <points ref={ref} material={material} renderOrder={3}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aSize" array={sizes} count={count} itemSize={1} />
        <bufferAttribute attach="attributes-aAlpha" array={alphas} count={count} itemSize={1} />
      </bufferGeometry>
    </points>
  )
}

/** Observed slick: the detected polygon as a dark film with a sheen edge. */
function ObservedSlick({ points, pal }) {
  const geometry = useMemo(() => {
    if (!points || points.length < 3) return null
    const shape = new THREE.Shape()
    shape.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1])
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [points])

  const outline = useMemo(() => {
    if (!points || points.length < 3) return null
    const pts = points.map(([x, z]) => new THREE.Vector3(x, 0.1, z))
    pts.push(pts[0].clone())
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [points])

  useEffect(() => () => { geometry?.dispose(); outline?.dispose() }, [geometry, outline])
  if (!geometry) return null

  return (
    <group renderOrder={2}>
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
        <meshBasicMaterial color={pal.oil} transparent opacity={0.62} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {outline && (
        <line geometry={outline}>
          <lineBasicMaterial color={pal.observed} transparent opacity={0.85} />
        </line>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Origin, corridor, flow                                              */

function OriginMarker({ position, radiusKm, pal }) {
  const ripple = useRef()
  const ripple2 = useRef()

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (ripple.current) {
      const p = (t * 0.45) % 1
      const s = 0.4 + p * 1.1
      ripple.current.scale.set(s, 1, s)
      ripple.current.material.opacity = (1 - p) * 0.4
    }
    if (ripple2.current) {
      const p = ((t * 0.45) + 0.5) % 1
      const s = 0.4 + p * 1.1
      ripple2.current.scale.set(s, 1, s)
      ripple2.current.material.opacity = (1 - p) * 0.4
    }
  })

  const inner = Math.max(radiusKm - 0.22, 0.08)
  return (
    <group position={[position[0], 0, position[1]]} renderOrder={4}>
      <mesh position={[0, 0.45, 0]}>
        <sphereGeometry args={[0.42, 20, 20]} />
        <meshBasicMaterial color={pal.origin} />
      </mesh>
      <mesh position={[0, 2.4, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 4.6, 10]} />
        <meshBasicMaterial color={pal.origin} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {[ripple, ripple2].map((r, i) => (
        <mesh key={i} ref={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
          <ringGeometry args={[inner, radiusKm, 64]} />
          <meshBasicMaterial color={pal.origin} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      <pointLight color={pal.origin} intensity={2.2} distance={24} />
      <Html distanceFactor={95} position={[0, 5.4, 0]} zIndexRange={[10, 0]}>
        <div
          className="px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap border"
          style={{ background: pal.label, color: pal.origin, borderColor: pal.origin }}
        >
          PROBABLE ORIGIN
        </div>
      </Html>
    </group>
  )
}

/** Drift corridor: widening translucent band, narrow at the origin. */
function DriftCorridor({ path, project, pal }) {
  const { ribbon, centre } = useMemo(() => {
    if (!path || path.length < 2) return { ribbon: null, centre: null }
    const pts = path.map((p) => project(p.lon, p.lat))
    const verts = []
    const n = pts.length

    for (let i = 0; i < n; i += 1) {
      const [x, z] = pts[i]
      const [px, pz] = pts[Math.max(0, i - 1)]
      const [nx, nz] = pts[Math.min(n - 1, i + 1)]
      let dx = nx - px
      let dz = nz - pz
      const len = Math.hypot(dx, dz) || 1
      dx /= len; dz /= len
      // Uncertainty grows downstream.
      const halfW = 0.4 + (i / (n - 1)) * (path[i].spread_km ?? 1.2) * 1.5
      verts.push([x - dz * halfW, z + dx * halfW], [x + dz * halfW, z - dx * halfW])
    }

    const pos = new Float32Array(verts.length * 3)
    const alpha = new Float32Array(verts.length)
    for (let i = 0; i < verts.length; i += 1) {
      pos[i * 3] = verts[i][0]
      pos[i * 3 + 1] = 0.04
      pos[i * 3 + 2] = verts[i][1]
      alpha[i] = 0.30 * (1 - Math.abs((i % 2) * 2 - 1) * 0.0) // uniform across width
    }
    const idx = []
    for (let i = 0; i < n - 1; i += 1) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3
      idx.push(a, b, c, b, d, c)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1))
    g.setIndex(idx)

    const line = new THREE.BufferGeometry().setFromPoints(
      pts.map(([x, z]) => new THREE.Vector3(x, 0.14, z)),
    )
    return { ribbon: g, centre: line }
  }, [path, project])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `
          attribute float aAlpha; varying float vA;
          void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: `
          uniform vec3 uColor; varying float vA;
          void main(){ gl_FragColor = vec4(uColor, vA); }
        `,
        uniforms: { uColor: { value: new THREE.Color(pal.origin) } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [pal.origin],
  )

  useEffect(() => () => { ribbon?.dispose(); centre?.dispose(); material.dispose() },
    [ribbon, centre, material])

  if (!ribbon) return null
  return (
    <group renderOrder={1}>
      <mesh geometry={ribbon} material={material} />
      {centre && (
        <line geometry={centre}>
          <lineBasicMaterial color={pal.origin} transparent opacity={0.5} />
        </line>
      )}
    </group>
  )
}

/** Drifting surface motes showing the current direction. */
function CurrentFlow({ directionDeg, speedMs, pal }) {
  const ref = useRef()
  const COUNT = 220
  const FIELD = 150

  const seeds = useMemo(() => {
    const p = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i += 1) {
      // Deterministic scatter (hash, not RNG) so the field is stable.
      const a = Math.abs((Math.sin(i * 78.233) * 43758.5453) % 1)
      const b = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1)
      p[i * 3] = (a - 0.5) * FIELD
      p[i * 3 + 1] = 0.35
      p[i * 3 + 2] = (b - 0.5) * FIELD
    }
    return p
  }, [])

  const base = useMemo(() => Float32Array.from(seeds), [seeds])

  useFrame(({ clock }) => {
    if (!ref.current) return
    const rad = ((directionDeg ?? 145) * Math.PI) / 180
    const dx = Math.sin(rad)
    const dz = Math.cos(rad)
    // Visual speed only; the scientific value is displayed in the panels.
    const travel = (clock.getElapsedTime() * Math.max(speedMs ?? 0.3, 0.05) * 6) % FIELD
    const arr = ref.current.geometry.attributes.position.array
    for (let i = 0; i < COUNT; i += 1) {
      const off = (travel + (i % 37) * (FIELD / 37)) % FIELD - FIELD / 2
      arr[i * 3] = base[i * 3] + dx * off
      arr[i * 3 + 2] = base[i * 3 + 2] + dz * off
      // Wrap into the field.
      if (arr[i * 3] > FIELD / 2) arr[i * 3] -= FIELD
      if (arr[i * 3] < -FIELD / 2) arr[i * 3] += FIELD
      if (arr[i * 3 + 2] > FIELD / 2) arr[i * 3 + 2] -= FIELD
      if (arr[i * 3 + 2] < -FIELD / 2) arr[i * 3 + 2] += FIELD
    }
    ref.current.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={ref} renderOrder={1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={seeds} count={COUNT} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color={pal.flow} size={0.28} transparent opacity={0.4} sizeAttenuation depthWrite={false} />
    </points>
  )
}

/* ------------------------------------------------------------------ */
/* Vessels                                                             */

function Vessel({ vessel, project, isSelected, isTop, onSelect, currentDateRef, pal }) {
  const group = useRef()
  const hull = useRef()
  const wake = useRef()

  const color = isTop ? pal.topVessel : isSelected ? '#3BA7F2' : pal.vessel
  const scale = isTop ? 1.35 : isSelected ? 1.15 : 0.9

  const hullGeo = useMemo(() => createHullGeometry(1.0), [])
  const wakeGeo = useMemo(() => createWakeGeometry(7, 1.1), [])
  const wakeMat = useMemo(() => createWakeMaterial(pal.foam), [pal.foam])

  const trackGeo = useMemo(() => {
    const traj = vessel.trajectory ?? []
    if (traj.length < 2) return null
    return new THREE.BufferGeometry().setFromPoints(
      traj.map((p) => {
        const [x, z] = project(p.lon, p.lat)
        return new THREE.Vector3(x, 0.1, z)
      }),
    )
  }, [vessel.trajectory, project])

  useEffect(() => () => {
    hullGeo.dispose(); wakeGeo.dispose(); wakeMat.dispose(); trackGeo?.dispose()
  }, [hullGeo, wakeGeo, wakeMat, trackGeo])

  useFrame(({ clock }) => {
    const g = group.current
    const cur = currentDateRef.current
    if (!g || !cur) return
    const traj = vessel.trajectory ?? []
    if (!traj.length) return

    const t = cur.getTime()
    let lon = traj[traj.length - 1].lon
    let lat = traj[traj.length - 1].lat
    let heading = traj[traj.length - 1].heading ?? 0
    let moving = false

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
          const h0 = traj[i].heading ?? 0
          const h1 = traj[i + 1].heading ?? h0
          let dh = ((h1 - h0 + 540) % 360) - 180   // shortest arc
          heading = h0 + dh * f
          moving = true
          break
        }
      }
    }

    const [x, z] = project(lon, lat)
    const bob = Math.sin(clock.getElapsedTime() * 1.3 + x * 0.3) * 0.09
    const roll = Math.sin(clock.getElapsedTime() * 0.9 + z * 0.2) * 0.035

    g.position.set(x, 0.18 + bob, z)
    g.rotation.y = -(heading * Math.PI) / 180
    g.rotation.z = roll

    if (wake.current) wake.current.visible = moving
  })

  return (
    <group renderOrder={4}>
      {trackGeo && (
        <line geometry={trackGeo}>
          <lineBasicMaterial
            color={color}
            transparent
            opacity={isSelected || isTop ? 0.8 : 0.18}
          />
        </line>
      )}

      <group
        ref={group}
        scale={[scale, scale, scale]}
        onClick={(e) => { e.stopPropagation(); onSelect(vessel.id) }}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <mesh ref={hull} geometry={hullGeo} position={[0, 0, 0]}>
          <meshStandardMaterial
            color={color}
            roughness={0.55}
            metalness={0.25}
            emissive={color}
            emissiveIntensity={isTop ? 0.28 : isSelected ? 0.18 : 0.05}
          />
        </mesh>

        {/* superstructure, aft */}
        <mesh position={[0, 0.26, -0.42]}>
          <boxGeometry args={[0.34, 0.3, 0.42]} />
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.15} />
        </mesh>

        <mesh ref={wake} geometry={wakeGeo} material={wakeMat} position={[0, -0.07, -0.9]} />

        {(isTop || isSelected) && (
          <Html distanceFactor={115} position={[0, 1.9, 0]} zIndexRange={[9, 0]}>
            <div
              className="px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap border"
              style={{ background: pal.label, color, borderColor: color }}
            >
              #{vessel.rank} {vessel.name}
            </div>
          </Html>
        )}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */

function VectorArrow({ position, directionDeg, color, label, length = 6, pal }) {
  const rad = (directionDeg * Math.PI) / 180
  return (
    <group position={[position[0], 1.1, position[1]]} rotation={[0, -rad, 0]}>
      <mesh position={[0, 0, length / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, length, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, 0, length]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.24, 0.7, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </mesh>
      <Html distanceFactor={140} position={[0, 0.8, length]} zIndexRange={[8, 0]}>
        <div
          className="px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap"
          style={{ background: pal.label, color }}
        >
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
  const { selectedVesselId, setSelectedVessel, simulationTime } = useInvestigationStore()
  const { isDark } = useThemeStore()
  const [webgl] = useState(() => hasWebGL())

  const pal = isDark ? PALETTE.dark : PALETTE.light

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
  const frameTimes = useMemo(() => frames.map((f) => new Date(f.time).getTime()), [frames])

  const fractionalFrame = useMemo(() => {
    if (!frameTimes.length || !currentDate) return 0
    const t = currentDate.getTime()
    if (t <= frameTimes[0]) return 0
    const last = frameTimes.length - 1
    if (t >= frameTimes[last]) return last
    let lo = 0
    let hi = last
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (frameTimes[mid] <= t) lo = mid
      else hi = mid
    }
    const span = frameTimes[lo + 1] - frameTimes[lo]
    const frac = span > 0 ? (t - frameTimes[lo]) / span : 0
    return lo + frac
  }, [frameTimes, currentDate])

  // Refs keep the render loop out of React's update path.
  const frameIndexRef = useRef(0)
  const currentDateRef = useRef(null)
  useEffect(() => { frameIndexRef.current = fractionalFrame }, [fractionalFrame])
  useEffect(() => { currentDateRef.current = currentDate }, [currentDate])

  const focus = useMemo(() => {
    const sel = vessels.find((v) => v.id === selectedVesselId)
    if (!sel?.trajectory?.length) return [0, 0]
    const p = sel.trajectory[Math.floor(sel.trajectory.length / 2)]
    return project(p.lon, p.lat)
  }, [selectedVesselId, vessels, project])

  if (!webgl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="txt font-semibold">WebGL unavailable</p>
        <p className="txt-muted text-sm max-w-sm">
          This browser or GPU cannot render the 3D scene. Switch to the 2D Map
          view — it shows the same investigation data.
        </p>
      </div>
    )
  }

  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [48, 34, 48], fov: 52 }}
      gl={{ antialias: true, alpha: false }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={[pal.bg]} />
        <fog attach="fog" args={[pal.fog, pal.fogNear, pal.fogFar]} />

        <ambientLight intensity={pal.ambient} />
        <directionalLight position={[60, 85, 45]} intensity={pal.dirLight} color="#fff6e8" />
        <hemisphereLight args={[pal.foam, pal.deep, 0.35]} />

        <Ocean pal={pal} currentDirDeg={drift.environment?.current_direction_deg} />

        {/* Reference grid kept, but faint: the ocean dominates. */}
        <Grid
          args={[240, 240]}
          cellSize={5}
          cellColor={pal.gridCell}
          sectionSize={25}
          sectionColor={pal.gridSection}
          fadeDistance={170}
          fadeStrength={1.6}
          position={[0, 0.02, 0]}
          infiniteGrid={false}
          side={THREE.DoubleSide}
        />

        <CurrentFlow
          directionDeg={drift.environment?.current_direction_deg}
          speedMs={drift.environment?.current_speed_ms}
          pal={pal}
        />

        <DriftCorridor path={drift.path} project={project} pal={pal} />
        <ObservedSlick points={spillPoints} pal={pal} />
        <OilSlick frames={frames} project={project} frameIndexRef={frameIndexRef} pal={pal} />

        {origin.lat !== undefined && (
          <OriginMarker
            position={originXZ}
            radiusKm={origin.uncertainty_radius_km ?? 1}
            pal={pal}
          />
        )}

        {drift.environment && (
          <>
            <VectorArrow
              position={[originXZ[0] - 16, originXZ[1] - 14]}
              directionDeg={drift.environment.current_direction_deg}
              color={pal.flow}
              label={`Current ${drift.environment.current_speed_ms?.toFixed(2)} m/s`}
              pal={pal}
            />
            <VectorArrow
              position={[originXZ[0] - 16, originXZ[1] - 22]}
              directionDeg={drift.environment.wind_direction_deg}
              color={pal.foam}
              label={`Wind ${drift.environment.wind_speed_ms?.toFixed(1)} m/s`}
              pal={pal}
            />
          </>
        )}

        {vessels.map((v) => (
          <Vessel
            key={v.id}
            vessel={v}
            project={project}
            isSelected={v.id === selectedVesselId}
            isTop={v.rank === 1}
            onSelect={setSelectedVessel}
            currentDateRef={currentDateRef}
            pal={pal}
          />
        ))}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={Math.PI / 2.15}
          minDistance={8}
          maxDistance={220}
        />
        <CameraRig focus={focus} />
      </Suspense>
    </Canvas>
  )
}
