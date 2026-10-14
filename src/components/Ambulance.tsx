import { cn } from '../lib/cn'

interface Props {
  /** rendered body length in px */
  lengthPx: number
  /** visual treatment: active unit gets full strobe */
  lights: boolean
  arrived?: boolean
}

/**
 * Top-down ambulance. Front is +x. Emergency beacons animate via CSS
 * (beacon-a / beacon-b alternate), the halo pulses below the body.
 */
export default function Ambulance({ lengthPx, lights, arrived }: Props) {
  const h = lengthPx * 0.44
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2"
      style={{ width: lengthPx, height: h }}
    >
      {/* pulsing halo — centered container so the scale keyframes stay centered */}
      <div
        className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ width: lengthPx * 2.1, height: lengthPx * 2.1, opacity: lights ? 1 : 0.25 }}
      >
        <div
          className={cn('h-full w-full rounded-full', lights && 'halo-pulse')}
          style={{
            background:
              'radial-gradient(circle, rgba(47,224,138,0.2) 0%, rgba(56,196,224,0.07) 45%, transparent 70%)',
          }}
        />
      </div>

      <div className="relative h-full w-full">
        {/* body */}
        <div
          className="relative h-full w-full overflow-hidden rounded-[3px] border border-[#0d1420]"
          style={{
            backgroundColor: arrived ? '#dfe6ee' : '#f4f7fb',
            boxShadow: '0 1px 3px rgba(0,0,0,0.55), 0 0 12px rgba(150,190,235,0.25)',
          }}
        >
          <div className="absolute inset-x-0 top-0 h-[22%] bg-white/70" />
          <div className="absolute inset-x-0 bottom-0 h-[20%] bg-[#c3ccd9]" />
          {/* box + windshield */}
          <div className="absolute inset-y-[16%] right-0 w-[24%] rounded-r-[2px] bg-[#cfd8e4]" />
          <div
            className="absolute inset-y-[22%] right-[16%] w-[9%] rounded-[1px]"
            style={{ backgroundColor: 'rgba(120,180,235,0.85)' }}
          />
          {/* rear doors seam */}
          <div className="absolute inset-y-[12%] left-0 w-[1.5px] bg-black/25" />
          {/* small side red band */}
          <div className="absolute inset-y-0 left-[40%] w-[1.2px] bg-[#d9445a]/80" />
        </div>

        {/* roof light bar */}
        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-[1.5px] bg-[#232a38] px-[1px]"
          style={{ width: lengthPx * 0.4, height: h * 0.42 }}
        >
          <span
            className={cn('h-full w-1/2 rounded-l-[1px]', lights && 'beacon-a')}
            style={{ backgroundColor: lights ? '#ff4055' : '#4a3c44' }}
          />
          <span
            className={cn('h-full w-1/2 rounded-r-[1px]', lights && 'beacon-b')}
            style={{ backgroundColor: lights ? '#39c8ff' : '#31464f' }}
          />
        </div>
      </div>
    </div>
  )
}
