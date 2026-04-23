import { describe, expect, it } from 'vitest'
import {
  cameraAnglesRelativeToLine,
  cameraForwardDirection,
  cardLinePosition,
  cardRotationFromLine,
  facingAdjustedLineAngles,
  sphericalDirection,
  type Vec3,
} from '../src/ui/lib/card-stack-3d'

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function magnitude(v: Vec3): number {
  return Math.sqrt(dot(v, v))
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function expectVecClose(actual: Vec3, expected: Vec3, precision = 8): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision)
  expect(actual[1]).toBeCloseTo(expected[1], precision)
  expect(actual[2]).toBeCloseTo(expected[2], precision)
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

function cardNormalFromRotation(rotYDeg: number, rotXDeg: number): Vec3 {
  const y = toRadians(rotYDeg)
  const x = toRadians(rotXDeg)
  return [Math.sin(y) * Math.cos(x), -Math.sin(x), Math.cos(y) * Math.cos(x)]
}

function cssToScene(v: Vec3): Vec3 {
  return [v[0], -v[1], v[2]]
}

describe('sphericalDirection', () => {
  it('uses theta as azimuth and phi as elevation', () => {
    expectVecClose(sphericalDirection(0, 0), [1, 0, 0])
    expectVecClose(sphericalDirection(90, 0), [0, 0, 1])
    expectVecClose(sphericalDirection(-90, 0), [0, 0, -1])
    expectVecClose(sphericalDirection(0, 90), [0, 1, 0])
    expectVecClose(sphericalDirection(0, -90), [0, -1, 0])
  })

  it('always returns a unit-length direction vector', () => {
    const probes: Array<[number, number]> = [
      [0, 0],
      [45, 30],
      [120, -18],
      [-150, 62],
      [179, -89],
    ]

    for (const [theta, phi] of probes) {
      const dir = sphericalDirection(theta, phi)
      expect(magnitude(dir)).toBeCloseTo(1, 8)
    }
  })
})

describe('cardLinePosition', () => {
  it('keeps cards on one line with exact cardGap spacing', () => {
    const direction = sphericalDirection(37, -22)
    const cardGap = 230

    const focus = cardLinePosition(0, cardGap, direction)
    expectVecClose(focus, [0, 0, 0])

    for (let offset = -4; offset <= 4; offset += 1) {
      const pos = cardLinePosition(offset, cardGap, direction)
      const expected: Vec3 = [
        direction[0] * offset * cardGap,
        direction[1] * offset * cardGap,
        direction[2] * offset * cardGap,
      ]
      expectVecClose(pos, expected)
    }

    for (let offset = -3; offset <= 3; offset += 1) {
      const a = cardLinePosition(offset, cardGap, direction)
      const b = cardLinePosition(offset + 1, cardGap, direction)
      expect(magnitude(subtract(b, a))).toBeCloseTo(cardGap, 8)
    }
  })
})

describe('cardRotationFromLine', () => {
  it('keeps card normal aligned with line direction in CSS coordinates', () => {
    const probes: Array<[number, number]> = [
      [0, 0],
      [90, 0],
      [-90, 0],
      [35, 20],
      [-130, -32],
      [170, 65],
      [-170, -65],
    ]

    for (const [theta, phi] of probes) {
      const direction = sphericalDirection(theta, phi)
      const { rotYDeg, rotXDeg } = cardRotationFromLine(theta, phi)
      const normal = cardNormalFromRotation(rotYDeg, rotXDeg)
      const expectedCssDirection: Vec3 = [direction[0], -direction[1], direction[2]]
      expectVecClose(normal, expectedCssDirection, 7)
    }
  })

  it('keeps yaw continuous across the -90 azimuth seam', () => {
    const before = cardRotationFromLine(-90.5, 0)
    const at = cardRotationFromLine(-90, 0)
    const after = cardRotationFromLine(-89.5, 0)
    expect(before.rotYDeg).toBeCloseTo(180.5, 8)
    expect(at.rotYDeg).toBeCloseTo(180, 8)
    expect(after.rotYDeg).toBeCloseTo(179.5, 8)
  })
})

describe('facingAdjustedLineAngles', () => {
  it('keeps cards on the line axis and biases front-face toward camera', () => {
    const probes: Array<[number, number, number, number]> = [
      [0, 0, 90, 0],
      [90, 0, 90, 0],
      [-90, 0, 90, 0],
      [35, 20, 90, -14],
      [-135, 35, 160, -22],
      [170, -40, -60, 18],
      [-170, 65, 250, -35],
    ]

    for (const [lineTheta, linePhi, camTheta, camPhi] of probes) {
      const adjusted = facingAdjustedLineAngles(lineTheta, linePhi, camTheta, camPhi)
      const lineDirection = sphericalDirection(lineTheta, linePhi)
      const cameraForward = cameraForwardDirection(camTheta, camPhi)
      const { rotYDeg, rotXDeg } = cardRotationFromLine(adjusted.thetaDeg, adjusted.phiDeg)
      const normalScene = cssToScene(cardNormalFromRotation(rotYDeg, rotXDeg))

      // The card normal must stay aligned to the same line axis (+d or -d).
      expect(Math.abs(dot(normalScene, lineDirection))).toBeCloseTo(1, 7)
      // And the chosen sign should keep front-face toward the camera direction.
      expect(dot(normalScene, cameraForward)).toBeLessThanOrEqual(1e-8)
    }
  })

  it('flips when line points away from camera and keeps when it points toward camera', () => {
    expect(facingAdjustedLineAngles(-90, 0, 90, 0).flipped).toBe(true)
    expect(facingAdjustedLineAngles(90, 0, 90, 0).flipped).toBe(false)
  })
})

describe('cameraAnglesRelativeToLine', () => {
  it('is identity when line is aligned to default +X frame', () => {
    const probes: Array<[number, number]> = [
      [90, -14],
      [0, 0],
      [150, 20],
      [-170, -55],
    ]
    for (const [camTheta, camPhi] of probes) {
      const result = cameraAnglesRelativeToLine(0, 0, camTheta, camPhi)
      expect(result.thetaDeg).toBeCloseTo(camTheta, 8)
      expect(result.phiDeg).toBeCloseTo(camPhi, 8)
    }
  })

  it('keeps camera orientation consistent relative to card line frame', () => {
    const camTheta = 90
    const camPhi = -14
    const baselineAngles = cameraAnglesRelativeToLine(0, 0, camTheta, camPhi)
    const baselineForward = cameraForwardDirection(baselineAngles.thetaDeg, baselineAngles.phiDeg)
    const baselineDot = dot(baselineForward, sphericalDirection(0, 0))

    const lineProbes: Array<[number, number]> = [
      [35, 20],
      [-120, -30],
      [170, 65],
      [-170, -65],
    ]

    for (const [lineTheta, linePhi] of lineProbes) {
      const worldAngles = cameraAnglesRelativeToLine(lineTheta, linePhi, camTheta, camPhi)
      const forward = cameraForwardDirection(worldAngles.thetaDeg, worldAngles.phiDeg)
      const lineDir = sphericalDirection(lineTheta, linePhi)
      expect(dot(forward, lineDir)).toBeCloseTo(baselineDot, 7)
    }
  })
})
