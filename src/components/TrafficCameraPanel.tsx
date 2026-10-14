import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, RotateCcw, Upload, Video, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { MicroLabel, Led, Pill } from './ui'
import { detectFrame } from '../backend/cameraClient'
import { storeCameraDemand, storeCameraMetrics, clearAllDemand } from '../engine/trafficDemand'
import { cameraBackendOnline, getCameraMetrics, msSinceLastCameraUpdate } from '../engine/trafficDemand'
import type { CameraMetrics, FrameDetectionResult, ApproachMetrics } from '../types/perception'

const DEMO_JUNCTION = 'J30'

export default function TrafficCameraPanel() {
  const vidRef = useRef<HTMLVideoElement>(null)
  const cvsRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const pollRef = useRef<number>(0)
  const fileRef = useRef<File | null>(null)
  const backendRef = useRef<{ healthy: boolean; lastProbeMs: number }>({ healthy: false, lastProbeMs: 0 })
  /** backend reachability (health probe) vs. live detection flow are separate */
  const [backend, setBackend] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE')
  const [live, setLive] = useState(false)
  const [metrics, setMetrics] = useState<CameraMetrics | null>(null)
  const [source, setSource] = useState<'CAMERA' | 'SIMULATION' | 'FUSED'>('SIMULATION')
  const [filename, setFilename] = useState<string>('')
  const [playState, setPlayState] = useState<'playing' | 'paused' | 'idle'>('idle')
  const [cameraId] = useState('CAM-01')
  const [intersection] = useState('CENTRAL INTERSECTION · J30')

  const syncSource = useCallback(() => {
    const m = getCameraMetrics()
    const ms = msSinceLastCameraUpdate()
    const camActive = m !== null && ms < 6_000
    // backend reachability is probed once at App level (single shared probe);
    // this panel only READS the published state — no second polling loop
    const healthy = cameraBackendOnline()
    backendRef.current = { healthy, lastProbeMs: Date.now() }
    setBackend(healthy ? 'ONLINE' : 'OFFLINE')
    setSource(camActive ? 'CAMERA' : 'SIMULATION')
    setLive(camActive)
  }, [])

  // metrics display refresh
  useEffect(() => {
    let alive = true
    const t = setInterval(() => { if (alive) syncSource() }, 1_000)
    return () => { alive = false; clearInterval(t) }
  }, [syncSource])

  // frame capture → send to backend
  const pollFrame = useCallback(async () => {
    const vid = vidRef.current
    const cvs = cvsRef.current
    if (!vid || !cvs || vid.readyState < 2 || vid.videoWidth === 0) return
    cvs.width = vid.videoWidth
    cvs.height = vid.videoHeight
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    ctx.drawImage(vid, 0, 0, cvs.width, cvs.height)
    const blob = await new Promise<Blob | null>((res) => {
      try { cvs.toBlob(res, 'image/jpeg', 0.55) } catch { res(null) }
    })
    if (!blob) return
    const base64 = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result).split(',')[1] ?? '')
      r.onerror = () => rej(new DOMException('frame read'))
      r.readAsDataURL(blob)
    }).catch(() => '')
    if (!base64) return

    const res = await detectFrame(base64, DEMO_JUNCTION).catch(() => null)
    if (!res) return
    storeCameraMetrics(res.camera_metrics)
    const m = res.camera_metrics
    setMetrics(m)
    // store camera demand for the optimizer
    const approaches = m.approaches || []
    const mainApp = approaches.find((a: ApproachMetrics) => a.approach_id === 'M' || a.approach_id === 'NORTH') ?? approaches[0]
    const crossApp = approaches.find((a: ApproachMetrics) => a.approach_id === 'X' || a.approach_id === 'EAST') ?? (approaches.length > 1 ? approaches[1] : null)
    storeCameraDemand(DEMO_JUNCTION, {
      source: 'CAMERA',
      intersection_id: DEMO_JUNCTION,
      timestamp: res.timestamp,
      m_vehicle_count: mainApp?.vehicle_count ?? res.total_vehicles,
      m_estimated_queue: mainApp?.estimated_queue ?? m.estimated_queue,
      m_density: mainApp?.density ?? m.traffic_density,
      m_approaching: mainApp?.approaching_count ?? res.total_vehicles,
      m_stopped: mainApp?.stopped_count ?? 0,
      x_vehicle_count: crossApp?.vehicle_count ?? res.total_vehicles,
      x_estimated_queue: crossApp?.estimated_queue ?? m.estimated_queue,
      x_density: crossApp?.density ?? m.traffic_density,
      x_approaching: crossApp?.approaching_count ?? 0,
      x_stopped: crossApp?.stopped_count ?? 0,
      camera_weight: 0.7,
      simulation_weight: 0.3,
    })
    syncSource()
    drawOverlay(overlayRef.current, cvs, res.detections)
  }, [syncSource])

  const drawOverlay = useCallback((
    ov: HTMLCanvasElement | null,
    src: HTMLCanvasElement,
    dets: FrameDetectionResult['detections'],
  ) => {
    if (!ov || !src) return
    ov.width = src.width
    ov.height = src.height
    const c = ov.getContext('2d')
    if (!c) return
    c.clearRect(0, 0, ov.width, ov.height)
    for (const d of dets) {
      const x1 = Math.max(0, d.bbox.x1), y1 = Math.max(0, d.bbox.y1)
      const x2 = Math.min(src.width, d.bbox.x2), y2 = Math.min(src.height, d.bbox.y2)
      c.strokeStyle = 'rgba(232,161,60,0.85)'
      c.lineWidth = 1.6
      c.strokeRect(x1, y1, x2 - x1, y2 - y1)
      c.fillStyle = 'rgba(0,0,0,0.55)'
      c.fillRect(x1, y1, 56, 13)
      c.fillStyle = '#f4d35e'
      c.font = '10px ui-monospace, monospace'
      c.fillText(`${d.vehicle_class} ${(d.confidence * 100).toFixed(0)}`, x1 + 4, y1 + 10)
    }
  }, [])

  const play = () => {
    const vid = vidRef.current
    if (!vid) return
    vid.play().then(() => setPlayState('playing')).catch(() => setPlayState('paused'))
  }
  const pause = () => { const v = vidRef.current; v && v.pause(); setPlayState('paused') }
  const restart = () => { const v = vidRef.current; v && (v.currentTime = 0); play() }

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    fileRef.current = file
    setFilename(file.name)
    const url = URL.createObjectURL(file)
    const vid = vidRef.current
    if (vid) {
      vid.src = url
      vid.load()
      vid.onloadeddata = () => { play(); setPlayState('playing') }
    }
  }, [play])

  useEffect(() => {
    if (playState !== 'playing' || !backendRef.current.healthy) {
      clearInterval(pollRef.current)
      return
    }
    const interval = 650
    pollRef.current = window.setInterval(pollFrame, interval)
    return () => clearInterval(pollRef.current)
  }, [playState, pollFrame])

  const hasVideo = Boolean(vidRef.current?.src && playState !== 'idle')

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.2 }}
      className="pointer-events-auto absolute bottom-[134px] right-4 z-30 w-[250px] shrink-0 rounded-md border border-white/[0.07] bg-night-850/80 backdrop-blur-[2px] shadow-[0_12px_30px_rgba(0,0,0,0.5)]"
    >
      {/* header — backend reachability and live detection flow are separate */}
      <div className="flex items-center justify-between border-b border-white/[0.05] px-2.5 py-1.5">
        <MicroLabel className="text-slate-400">TRAFFIC CAMERA</MicroLabel>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-500">{cameraId}</span>
          <Pill tone={backend === 'OFFLINE' ? 'red' : live ? 'green' : 'slate'}>
            {backend === 'OFFLINE' ? 'BACKEND · OFFLINE' : live ? 'CAMERA · LIVE' : 'BACKEND · ONLINE'}
          </Pill>
        </span>
      </div>

      {/* sensor source */}
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-2.5 py-1">
        <MicroLabel className="text-slate-600">SENSOR</MicroLabel>
        <span className="flex items-center gap-1.5">
          <Led tone={source === 'CAMERA' ? 'green' : source === 'FUSED' ? 'cyan' : 'slate'} pulse={source === 'CAMERA'} size={4} />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-300">
            {source === 'CAMERA' ? '· CAMERA' : source === 'FUSED' ? '· FUSED' : '· SIMULATION'}
          </span>
        </span>
      </div>

      {/* intersection */}
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-2.5 py-1">
        <Video size={11} className="text-ops-cyan/80" />
        <MicroLabel className="text-slate-500">{intersection}</MicroLabel>
      </div>

      {/* video */}
      <div className="relative shrink-0 mx-3 mt-2 overflow-hidden rounded border border-white/[0.06] bg-black/40" style={{ aspectRatio: '16/9' }}>
        <video
          ref={vidRef}
          className={cn('h-full w-full rounded object-contain brightness-[1.05] contrast-[1.05]', !hasVideo && 'hidden')}
          playsInline
          muted
          onEnded={restart}
        />
        <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <canvas ref={cvsRef} className="hidden" />
        {!hasVideo && (
          <div
            className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed border-white/10 bg-black/30 text-slate-500 transition-colors hover:border-white/20 hover:text-slate-300"
            onClick={() => document.getElementById('cam-upload')?.click()}
          >
            <Upload size={22} />
            <span className="font-mono text-[9px]">SELECT TRAFFIC VIDEO</span>
            <span className="font-mono text-[8px] text-slate-600">MP4 / WebM</span>
          </div>
        )}
        {/* controls */}
        {hasVideo && (
          <div className="absolute left-2 right-2 flex items-center justify-between gap-2 rounded-b border-t border-white/10 bg-black/50 p-1.5">
            <button type="button" className="flex items-center justify-center rounded border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300 hover:bg-white/10" onClick={restart} title="restart">
              <RotateCcw size={11} />
            </button>
            <button type="button" className="flex items-center justify-center rounded border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300 hover:bg-white/10" onClick={playState === 'playing' ? pause : play} title={playState === 'playing' ? 'pause' : 'play'}>
              {playState === 'playing' ? <Pause size={11} /> : <Play size={11} />}
            </button>
            <button type="button" className="flex items-center justify-center rounded border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300 hover:bg-white/10" onClick={() => { clearAllDemand(); setMetrics(null); pause(); const v = vidRef.current; v && (v.currentTime = 0); setPlayState('idle') }} title="stop & clear">
              <WifiOff size={11} />
            </button>
          </div>
        )}
      </div>

      {/* hidden file input */}
      <input id="cam-upload" type="file" accept="video/mp4,video/webm" className="hidden" onChange={onFile} />

      {/* metrics */}
      <div className="border-t border-white/[0.05] px-2.5 py-1.5">
        <MicroLabel className="text-slate-600 mb-1.5">PERCEPTION METRICS</MicroLabel>
        {live && metrics ? (
          <div className="grid grid-cols-2 gap-2">
            {metricCell('VEHICLES', metrics.total_detections, 'detected')}
            {metricCell('TRACKS', metrics.active_tracks, 'active')}
            {metricCell('QUEUE', metrics.estimated_queue, 'est. vehicles', 'text-ops-amber')}
            {metricCell('DENSITY', `${Math.round(metrics.traffic_density * 100)}%`, 'per ROI', metrics.traffic_density > 0.6 ? 'text-ops-red' : '')}
            {metricCell('INFERENCE', `${metrics.inference_fps.toFixed(1)} FPS`, `~${Math.round(1000 / metrics.inference_fps)} ms`)}
          </div>
        ) : backend === 'OFFLINE' ? (
          <div className="flex items-center gap-2 text-slate-500">
            <WifiOff size={11} />
            <span className="font-mono text-[9px] uppercase tracking-[0.1em]">CAMERA OFFLINE · FALLING BACK TO SIMULATION</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-500">
            <Video size={11} />
            <span className="font-mono text-[9px] uppercase tracking-[0.1em]">PLAY A VIDEO TO BEGIN DETECTION</span>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex items-center justify-between border-t border-white/[0.05] px-2.5 py-1">
        <span className="font-mono text-[7px] text-slate-600">YOLO11n · VEHICLE DETECTION</span>
        <span className="font-mono text-[7px] text-slate-600 truncate max-w-[130px]">{filename || 'no video loaded'}</span>
      </div>
    </motion.div>
  )
}

function metricCell(label: string, value: string | number, sub: string, valCls?: string, extra?: ReactNode) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="font-mono text-[8px] font-medium uppercase tracking-[0.14em] text-slate-600">{label}</div>
      <div className={cn('font-mono text-[13px] font-semibold text-slate-200', valCls)}>{value}</div>
      <div className="font-mono text-[7.5px] tracking-[0.1em] text-slate-600">{sub}</div>
      {extra}
    </div>
  )
}