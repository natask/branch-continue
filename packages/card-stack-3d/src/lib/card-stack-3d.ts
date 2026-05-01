export type Vec3 = readonly [number, number, number]
export type CardRotation = Readonly<{ rotYDeg: number; rotXDeg: number }>

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

// Returns card rotations for CSS `rotateY(...) rotateX(...)` so a card-plane
// normal matches any spherical direction after Y-up (scene) to Y-down (CSS) mapping.
export function cardRotationFromNormal(thetaDeg: number, phiDeg: number): CardRotation {
  return {
    // Keep this unwrapped for continuity: wrapping to [-180,180] introduces
    // a discontinuity at theta = -90 (179 -> -180) that causes visual jumps.
    rotYDeg: 90 - thetaDeg,
    rotXDeg: phiDeg,
  }
}

export function cardRotationFromOrientation(leftRightDeg: number, frontBackDeg: number): CardRotation {
  return {
    rotYDeg: leftRightDeg,
    rotXDeg: frontBackDeg,
  }
}
