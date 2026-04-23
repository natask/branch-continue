export type Vec3 = readonly [number, number, number]
export type CardRotation = Readonly<{ rotYDeg: number; rotXDeg: number }>
export type FacingAdjustedAngles = Readonly<{
  thetaDeg: number
  phiDeg: number
  flipped: boolean
}>
export type CameraAngles = Readonly<{
  thetaDeg: number
  phiDeg: number
}>

// Theta = azimuth around Y axis. Phi = elevation from XZ plane.
export function sphericalDirection(thetaDeg: number, phiDeg: number): Vec3 {
  const theta = (thetaDeg * Math.PI) / 180
  const phi = (phiDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  return [Math.cos(theta) * cosPhi, Math.sin(phi), Math.sin(theta) * cosPhi]
}

export function cardLinePosition(offset: number, cardGap: number, lineDirection: Vec3): Vec3 {
  const distance = offset * cardGap
  return [
    distance * lineDirection[0],
    distance * lineDirection[1],
    distance * lineDirection[2],
  ]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function magnitude(v: Vec3): number {
  return Math.sqrt(dot(v, v))
}

function normalize(v: Vec3): Vec3 {
  const m = magnitude(v)
  if (m < 1e-12) return [0, 0, 0]
  return [v[0] / m, v[1] / m, v[2] / m]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// Converts camera controls from the focused-card frame into world spherical angles.
// This keeps camera motion relative to the currently focused card orientation.
export function cameraAnglesRelativeToLine(
  lineThetaDeg: number,
  linePhiDeg: number,
  camThetaDeg: number,
  camPhiDeg: number,
): CameraAngles {
  const lineNormal = sphericalDirection(lineThetaDeg, linePhiDeg)

  // Build a stable card-frame basis in world space:
  // X = card normal(line), Y/Z = in-plane axes.
  const worldUp: Vec3 = [0, 1, 0]
  let inPlaneZ = cross(lineNormal, worldUp)
  if (magnitude(inPlaneZ) < 1e-8) {
    inPlaneZ = [0, 0, 1]
  }
  const zAxis = normalize(inPlaneZ)
  const yAxis = normalize(cross(zAxis, lineNormal))

  // Keep existing camera control semantics: camTheta/camPhi define origin->camera ray.
  const localRay = sphericalDirection(camThetaDeg, -camPhiDeg)
  const rayWorld = normalize([
    lineNormal[0] * localRay[0] + yAxis[0] * localRay[1] + zAxis[0] * localRay[2],
    lineNormal[1] * localRay[0] + yAxis[1] * localRay[1] + zAxis[1] * localRay[2],
    lineNormal[2] * localRay[0] + yAxis[2] * localRay[1] + zAxis[2] * localRay[2],
  ])

  return {
    thetaDeg: (Math.atan2(rayWorld[2], rayWorld[0]) * 180) / Math.PI,
    phiDeg: (-Math.asin(clamp(rayWorld[1], -1, 1)) * 180) / Math.PI,
  }
}

// Camera forward in Y-up scene space (direction camera is looking toward).
// Camera controls use theta around Y and phi elevation; world transform applies
// rotateX(-camPhi), so the camera pitch sign is inverted from scene Y-up math.
export function cameraForwardDirection(camThetaDeg: number, camPhiDeg: number): Vec3 {
  const [x, y, z] = sphericalDirection(camThetaDeg, -camPhiDeg)
  return [-x, -y, -z]
}

// Keep card plane orthogonal to the line axis, but choose +/- line direction so
// the card front generally faces the camera (prevents inside-out text).
export function facingAdjustedLineAngles(
  lineThetaDeg: number,
  linePhiDeg: number,
  camThetaDeg: number,
  camPhiDeg: number,
): FacingAdjustedAngles {
  const lineDirection = sphericalDirection(lineThetaDeg, linePhiDeg)
  const cameraForward = cameraForwardDirection(camThetaDeg, camPhiDeg)
  const flipped = dot(lineDirection, cameraForward) > 0
  if (!flipped) return { thetaDeg: lineThetaDeg, phiDeg: linePhiDeg, flipped: false }
  return {
    thetaDeg: lineThetaDeg + 180,
    phiDeg: -linePhiDeg,
    flipped: true,
  }
}

// Returns card rotations for CSS `rotateY(...) rotateX(...)` so card normal
// matches the center-line direction after Y-up (scene) to Y-down (CSS) mapping.
export function cardRotationFromLine(thetaDeg: number, phiDeg: number): CardRotation {
  return {
    // Keep this unwrapped for continuity: wrapping to [-180,180] introduces
    // a discontinuity at theta = -90 (179 -> -180) that causes visual jumps.
    rotYDeg: 90 - thetaDeg,
    rotXDeg: phiDeg,
  }
}
