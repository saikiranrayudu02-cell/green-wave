import { useEffect, useState } from 'react'
import { getDbHealth, onDbHealth, type DbHealth } from '../backend/repo'
import { getBusHealth, onBusHealth, type BusHealth } from '../backend/live'
import { getConvexHealth, onConvexHealth, type ConvexHealth } from '../backend/convex'

export interface SystemStatus {
  db: DbHealth
  bus: BusHealth
  /** Convex live-state bridge (independent from the database) */
  cx: ConvexHealth
  /** true when another command-center window has recently published */
  peersActive: boolean
}

export function useSystemStatus(): SystemStatus {
  const [db, setDb] = useState<DbHealth>(() => getDbHealth())
  const [bus, setBus] = useState<BusHealth>(() => getBusHealth())
  const [cx, setCx] = useState<ConvexHealth>(() => getConvexHealth())
  const [, force] = useState(0)

  useEffect(() => {
    const off1 = onDbHealth((h) => {
      setDb(h)
      force((n) => n + 1)
    })
    const off2 = onBusHealth((h) => {
      setBus(h)
      force((n) => n + 1)
    })
    const off3 = onConvexHealth((h) => {
      setCx(h)
      force((n) => n + 1)
    })
    // periodic tick — lets the peers indicator decay
    const t = window.setInterval(() => force((n) => n + 1), 2500)
    return () => {
      off1()
      off2()
      off3()
      window.clearInterval(t)
    }
  }, [])

  return { db, bus, cx, peersActive: bus.peers > 0 }
}