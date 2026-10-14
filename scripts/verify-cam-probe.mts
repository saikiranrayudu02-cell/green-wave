// Deterministic check of the shared camera-backend probe path that the
// System page renders (Step 15 §29 / §41 camera failure & recovery).
// Mirrors exactly what App.tsx does each 12 s tick:
//   probeHealth() → setCameraBackendOnline(h.reachable && h.modelLoaded)
import { execSync } from 'node:child_process'
import { probeHealth } from '../src/backend/cameraClient'
import { cameraBackendOnline, setCameraBackendOnline } from '../src/engine/trafficDemand'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1) baseline — backend should be up (sandbox supervisor keeps it alive)
  const h0 = await probeHealth()
  const online0 = h0.reachable && h0.modelLoaded
  console.log(`baseline probe -> reachable=${h0.reachable} modelLoaded=${h0.modelLoaded} → store ONLINE=${cameraBackendOnline()}`)

  // 2) kill backend, probe during the down window
  try {
    execSync('pkill -f "uvicorn backend.main:app --host 127.0.0.1 --port 8099"', { stdio: 'ignore' })
  } catch {
    /* already down */
  }
  await sleep(1200)
  const h1 = await probeHealth()
  const down = !(h1.reachable && h1.modelLoaded)
  console.log(`after kill probe -> reachable=${h1.reachable} → expected DOWN=${down}`)

  // 3) publish to the shared store (the exact App effect line)
  setCameraBackendOnline(h1.reachable && h1.modelLoaded)
  console.log(`store after publish -> cameraBackendOnline()=${cameraBackendOnline()} (System shows: ${cameraBackendOnline() ? 'ONLINE / NO DEGRADED' : 'OFFLINE / OPERATIONAL · CAMERA DEGRADED / SIMULATION FALLBACK'})`)

  // 4) wait for sandbox respawn, probe recovery
  let recovered = false
  for (let i = 0; i < 20; i++) {
    await sleep(1500)
    const h2 = await probeHealth()
    if (h2.reachable && h2.modelLoaded) {
      setCameraBackendOnline(true)
      recovered = true
      console.log(`recovery probe #${i + 1} -> reachable=${h2.reachable} modelLoaded=${h2.modelLoaded} → store back ONLINE=${cameraBackendOnline()}`)
      break
    }
  }
  console.log(`RECOVERY=${recovered ? 'OK' : 'FAILED'}`)
  if (!online0 || !down || !recovered) process.exitCode = 1
}

void main()
