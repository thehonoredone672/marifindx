import * as THREE from 'three'

/**
 * Lightweight procedural ocean material.
 *
 * Height is the sum of four directional sine waves of differing
 * amplitude, wavelength and heading. Normals are derived analytically
 * from the partial derivatives rather than recomputed from geometry,
 * which keeps this cheap enough for an integrated GPU while still
 * giving correct specular response on the wave faces.
 *
 * Shading = depth-mixed base colour + Fresnel rim + a single sun
 * specular lobe + a narrow foam band on the crests. Deliberately not
 * photoreal: the slick and vessel data must stay legible on top.
 */

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform vec2  uDir;

varying vec3  vWorld;
varying vec3  vNormal;
varying float vHeight;

// (amplitude, wavelength, speed, heading-offset radians)
const vec4 W0 = vec4(0.45, 26.0, 0.55,  0.00);
const vec4 W1 = vec4(0.26, 14.0, 0.85,  0.85);
const vec4 W2 = vec4(0.14,  7.5, 1.25, -0.65);
const vec4 W3 = vec4(0.07,  3.6, 1.80,  2.10);

void waveTerm(vec4 w, vec2 p, float t, vec2 baseDir, inout float h, inout vec2 grad) {
  float a = w.x * uAmp;
  float k = 6.2831853 / w.y;
  float c = cos(w.w), s = sin(w.w);
  vec2 d = normalize(vec2(baseDir.x * c - baseDir.y * s, baseDir.x * s + baseDir.y * c));
  float phase = k * dot(d, p) + t * w.z;
  h += a * sin(phase);
  grad += a * k * cos(phase) * d;
}

void main() {
  vec3 pos = position;
  vec2 p = vec2(pos.x, pos.y);   // plane is XY before the mesh rotation

  float h = 0.0;
  vec2 grad = vec2(0.0);
  vec2 baseDir = normalize(uDir + vec2(1e-5));

  waveTerm(W0, p, uTime, baseDir, h, grad);
  waveTerm(W1, p, uTime, baseDir, h, grad);
  waveTerm(W2, p, uTime, baseDir, h, grad);
  waveTerm(W3, p, uTime, baseDir, h, grad);

  pos.z += h;
  vHeight = h;

  // Analytic normal from the height gradient, in the plane's local frame.
  vNormal = normalize(vec3(-grad.x, -grad.y, 1.0));

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
uniform vec3  uDeep;
uniform vec3  uMid;
uniform vec3  uShallow;
uniform vec3  uFoam;
uniform vec3  uSun;
uniform float uSunStrength;
uniform float uOpacity;

varying vec3  vWorld;
varying vec3  vNormal;
varying float vHeight;

void main() {
  // The plane is rotated -90deg about X, so the local +Z normal becomes
  // world +Y. Swizzle rather than recompute.
  vec3 n = normalize(vec3(vNormal.x, vNormal.z, -vNormal.y));
  vec3 viewDir = normalize(cameraPosition - vWorld);

  // Distance from the camera stands in for optical depth: near water
  // reads lighter, far water falls to the deep tone.
  float dist = length(cameraPosition.xz - vWorld.xz);
  float depthMix = smoothstep(10.0, 110.0, dist);

  float crest = smoothstep(0.05, 0.55, vHeight);
  vec3 base = mix(uShallow, uMid, depthMix);
  base = mix(base, uDeep, depthMix * 0.65);
  base = mix(base, uShallow, crest * 0.25);

  // Fresnel: grazing angles reflect the sky, steep angles show body colour.
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  base = mix(base, uFoam, fres * 0.28);

  // Single sun lobe.
  vec3 sunDir = normalize(uSun);
  vec3 halfV = normalize(sunDir + viewDir);
  float spec = pow(max(dot(n, halfV), 0.0), 90.0) * uSunStrength;

  float diff = 0.55 + 0.45 * max(dot(n, sunDir), 0.0);

  // Narrow foam band on the sharpest crests only.
  float foam = smoothstep(0.62, 0.92, vHeight) * 0.16;

  vec3 col = base * diff + spec + uFoam * foam;

  gl_FragColor = vec4(col, uOpacity);
}
`

export function createOceanMaterial({
  deep, mid, shallow, foam, sunStrength = 0.45, opacity = 1.0,
  amplitude = 1.0, direction = [1, 0.35],
}) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: opacity < 1,
    uniforms: {
      uTime:        { value: 0 },
      uAmp:         { value: amplitude },
      uDir:         { value: new THREE.Vector2(direction[0], direction[1]) },
      uDeep:        { value: new THREE.Color(deep) },
      uMid:         { value: new THREE.Color(mid) },
      uShallow:     { value: new THREE.Color(shallow) },
      uFoam:        { value: new THREE.Color(foam) },
      uSun:         { value: new THREE.Vector3(0.45, 0.8, 0.35) },
      uSunStrength: { value: sunStrength },
      uOpacity:     { value: opacity },
    },
  })
}

/**
 * Low-poly vessel hull: a ship silhouette extruded to give freeboard,
 * plus a small superstructure block aft. Two draw calls, no textures.
 */
export function createHullGeometry(length = 1.0) {
  const s = new THREE.Shape()
  const L = length
  s.moveTo(0, 1.15 * L)          // bow
  s.lineTo(0.30 * L, 0.55 * L)
  s.lineTo(0.34 * L, -0.85 * L)
  s.lineTo(-0.34 * L, -0.85 * L)
  s.lineTo(-0.30 * L, 0.55 * L)
  s.closePath()

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.34 * L,
    bevelEnabled: true,
    bevelThickness: 0.05 * L,
    bevelSize: 0.05 * L,
    bevelSegments: 1,
  })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, 0, 0)
  return geo
}

/** Trailing wake: a triangle that widens and fades astern. */
export function createWakeGeometry(length = 6, width = 1.6) {
  const geo = new THREE.BufferGeometry()
  const verts = new Float32Array([
    0, 0, 0,
    -width, 0, -length,
    width, 0, -length,
  ])
  const alpha = new Float32Array([0.5, 0.0, 0.0])
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1))
  return geo
}

export const wakeVertexShader = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const wakeFragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(uColor, vAlpha); }
`

export function createWakeMaterial(color) {
  return new THREE.ShaderMaterial({
    vertexShader: wakeVertexShader,
    fragmentShader: wakeFragmentShader,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Soft round sprite so oil reads as a film blob, not a hard square dot. */
export function createBlobTexture(size = 64) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}
