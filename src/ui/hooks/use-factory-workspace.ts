import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  advanceWorkPacketPhase,
  createFactorySeedPackets,
  normalizeFactoryPackets,
  splitIntentIntoFactoryPackets,
  summarizeFactoryState,
  type WorkPacket,
} from '../../core/factory/work-packets'

const FACTORY_STORAGE_KEY = 'branch-continue:factory-workspace:v1'

export function useFactoryWorkspace() {
  const [packets, setPackets] = useState<WorkPacket[]>(readStoredPackets)
  const [open, setOpen] = useState(false)
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(() => packets[0]?.id ?? null)

  useEffect(() => {
    try {
      window.localStorage.setItem(FACTORY_STORAGE_KEY, JSON.stringify(packets))
    } catch {
      // Ignore local factory persistence failures.
    }
  }, [packets])

  const summary = useMemo(() => summarizeFactoryState(packets), [packets])
  const selectedPacket = useMemo(
    () => packets.find((packet) => packet.id === selectedPacketId) ?? summary.nextPacket ?? packets[0] ?? null,
    [packets, selectedPacketId, summary.nextPacket],
  )

  const selectPacket = useCallback((packetId: string) => {
    setSelectedPacketId(packetId)
    setOpen(true)
  }, [])

  const captureIntent = useCallback((intent: string): number => {
    const nextPackets = splitIntentIntoFactoryPackets(intent)
    if (nextPackets.length === 0) return 0

    setPackets((current) => [...nextPackets, ...current])
    setSelectedPacketId(nextPackets[0]?.id ?? null)
    setOpen(true)
    return nextPackets.length
  }, [])

  const advancePacket = useCallback((packetId: string) => {
    setPackets((current) =>
      current.map((packet) => (packet.id === packetId ? advanceWorkPacketPhase(packet) : packet)),
    )
  }, [])

  const resetWorkspace = useCallback(() => {
    const seed = createFactorySeedPackets()
    setPackets(seed)
    setSelectedPacketId(seed[0]?.id ?? null)
    setOpen(true)
  }, [])

  return {
    packets,
    summary,
    selectedPacket,
    open,
    setOpen,
    selectPacket,
    captureIntent,
    advancePacket,
    resetWorkspace,
  }
}

function readStoredPackets(): WorkPacket[] {
  if (typeof window === 'undefined') return createFactorySeedPackets()

  try {
    const raw = window.localStorage.getItem(FACTORY_STORAGE_KEY)
    if (!raw) return createFactorySeedPackets()

    const stored = normalizeFactoryPackets(JSON.parse(raw))
    return stored.length > 0 ? stored : createFactorySeedPackets()
  } catch {
    return createFactorySeedPackets()
  }
}
