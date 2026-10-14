import type { VehicleKind } from '../engine/vehicles'

interface Props {
  kind: VehicleKind
  tint: number
  /** rendered length in px (body follows road direction, front = +x) */
  lengthPx: number
}

const SEDAN: string[] = ['#c9d4e3', '#9fb1cc', '#6f90d2']
const TAXI = '#c9a24b'
const TRUCK: string[] = ['#5a6a85', '#6b7d9c']
const BUS = '#7e9cc0'

function bodyColor(kind: VehicleKind, tint: number): string {
  if (kind === 'taxi') return TAXI
  if (kind === 'truck') return TRUCK[tint % TRUCK.length]
  if (kind === 'bus') return BUS
  return SEDAN[tint % SEDAN.length]
}

export default function Vehicle({ kind, tint, lengthPx }: Props) {
  const h = kind === 'bus' ? lengthPx * 0.5 : kind === 'truck' ? lengthPx * 0.42 : lengthPx * 0.4
  const color = bodyColor(kind, tint)

  if (kind === 'bus') {
    return (
      <div
        className="pointer-events-none absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2"
        style={{ width: lengthPx, height: h }}
      >
        <div
          className="relative h-full w-full overflow-hidden rounded-[2.5px] border border-black/40"
          style={{ backgroundColor: color }}
        >
          {/* roof + skirt shading */}
          <div className="absolute inset-x-0 top-0 h-[22%] bg-white/12" />
          <div className="absolute inset-x-0 bottom-0 h-[14%] bg-black/25" />
          {/* window band */}
          <div
            className="absolute inset-x-[6%] top-[16%] h-[42%] rounded-[1px]"
            style={{ backgroundColor: 'rgba(148,190,235,0.55)' }}
          />
          {/* mullions */}
          <div className="absolute inset-y-[16%] left-[38%] w-[1.5px] bg-black/30" />
          <div className="absolute inset-y-[16%] left-[62%] w-[1.5px] bg-black/30" />
          {/* front windshield */}
          <div className="absolute inset-y-[10%] right-0 w-[10%] rounded-r-[2px] bg-[rgba(120,165,215,0.7)]" />
        </div>
      </div>
    )
  }

  if (kind === 'truck') {
    return (
      <div
        className="pointer-events-none absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2"
        style={{ width: lengthPx, height: h }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[2.5px] border border-black/40" style={{ backgroundColor: color }}>
          {/* container shading */}
          <div className="absolute inset-x-0 top-0 h-[30%] bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-[18%] bg-black/25" />
          {/* cab at the front (+x) */}
          <div
            className="absolute inset-y-[12%] right-0 w-[30%] rounded-r-[2px]"
            style={{ backgroundColor: color, filter: 'brightness(0.82)' }}
          />
          <div
            className="absolute inset-y-[20%] right-[22%] w-[10%] rounded-[1px]"
            style={{ backgroundColor: 'rgba(150,190,235,0.75)' }}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2"
      style={{ width: lengthPx, height: h }}
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-[2.5px] border border-black/40"
        style={{ backgroundColor: color }}
      >
        <div className="absolute inset-x-0 top-0 h-[26%] bg-white/14" />
        <div className="absolute inset-x-0 bottom-0 h-[16%] bg-black/22" />
        {/* front windshield */}
        <div
          className="absolute inset-y-[14%] right-0 w-[22%] rounded-[1px]"
          style={{ backgroundColor: 'rgba(148,190,235,0.6)' }}
        />
        {/* rear window */}
        <div
          className="absolute inset-y-[14%] left-0 w-[16%] rounded-[1px]"
          style={{ backgroundColor: 'rgba(15,25,40,0.45)' }}
        />
        {kind === 'taxi' && (
          <div className="absolute left-[38%] top-1/2 h-[1.5px] w-[22%] -translate-y-1/2 rounded-full bg-black/40" />
        )}
      </div>
    </div>
  )
}