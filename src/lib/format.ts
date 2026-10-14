export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0')
}

/** seconds -> "MM:SS" */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}

/** integer -> grouped thousands */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}
