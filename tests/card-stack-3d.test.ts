import { describe, expect, it } from 'vitest'
import {
  cardLinePosition,
  cardRotationFromNormal,
  cardRotationFromOrientation,
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

describe('cardRotationFromNormal', () => {
  it('keeps card normal aligned with the requested spherical direction in CSS coordinates', () => {
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
      const { rotYDeg, rotXDeg } = cardRotationFromNormal(theta, phi)
      const normal = cardNormalFromRotation(rotYDeg, rotXDeg)
      const expectedCssDirection: Vec3 = [direction[0], -direction[1], direction[2]]
      expectVecClose(normal, expectedCssDirection, 7)
    }
  })

  it('keeps yaw continuous across the -90 azimuth seam', () => {
    const before = cardRotationFromNormal(-90.5, 0)
    const at = cardRotationFromNormal(-90, 0)
    const after = cardRotationFromNormal(-89.5, 0)
    expect(before.rotYDeg).toBeCloseTo(180.5, 8)
    expect(at.rotYDeg).toBeCloseTo(180, 8)
    expect(after.rotYDeg).toBeCloseTo(179.5, 8)
  })
})

describe('cardRotationFromOrientation', () => {
  it('uses card orientation controls directly instead of deriving them from the stack line', () => {
    expect(cardRotationFromOrientation(42, -17)).toEqual({
      rotYDeg: 42,
      rotXDeg: -17,
    })
  })
})
