import { describe, expect, it } from 'vitest'
import {
  advanceWorkPacketPhase,
  createFactorySeedPackets,
  splitIntentIntoFactoryPackets,
  summarizeFactoryState,
} from '../src/core/factory/work-packets'

const NOW = '2026-06-22T05:00:00.000Z'

describe('factory work packets', () => {
  it('seeds the current software factory work as durable packets', () => {
    const packets = createFactorySeedPackets(NOW)

    expect(packets.map((packet) => packet.id)).toEqual([
      'factory-keyboard-shortcuts',
      'factory-work-packet-contract',
      'factory-status-surface',
      'factory-knowledge-loop',
    ])
    expect(packets[0]?.phase).toBe('test-design')
    expect(packets[0]?.verification).toContain('pnpm test')
  })

  it('splits one spoken intent into multiple typed packets', () => {
    const packets = splitIntentIntoFactoryPackets(
      '1. Fix Command K in inputs. 2. Plan the test first. 3. Why am I building a software factory? 4. Drill me so I do not forget the important ideas.',
      NOW,
    )

    expect(packets).toHaveLength(4)
    expect(packets.map((packet) => packet.kind)).toEqual([
      'implementation',
      'workflow',
      'question',
      'drill',
    ])
  })

  it('summarizes active state and picks the critical next packet', () => {
    const summary = summarizeFactoryState(createFactorySeedPackets(NOW))

    expect(summary.total).toBe(4)
    expect(summary.active).toBe(4)
    expect(summary.nextPacket?.id).toBe('factory-keyboard-shortcuts')
  })

  it('advances packets through the workflow with evidence', () => {
    const packet = createFactorySeedPackets(NOW)[1]!
    const next = advanceWorkPacketPhase(packet, '2026-06-22T06:00:00.000Z')

    expect(next.phase).toBe('test-design')
    expect(next.status).toBe('running')
    expect(next.evidence.at(-1)).toContain('advanced to test-design')
  })
})
