// ---------------------------------------------------------------------------
// GREENWAVE — backend configuration (Step 6)
//
// Everything here is env-driven and fails CLOSED to a fully local demo:
//   - Supabase (persistence + auth + realtime) activates only when
//     VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both present.
//   - DEMO MODE is on by default when no cloud is configured, so the command
//     center always boots. It can be forced off (real login wall) by setting
//     VITE_DEMO_MODE=false alongside cloud credentials.
// Never ship a service-role key or password through these flags.
// ---------------------------------------------------------------------------

/**
 * Supabase clients expect the bare project origin (https://<ref>.supabase.co).
 * It is easy to paste the REST URL (…/rest/v1/) from the dashboard instead —
 * normalize that away so the client always reaches /rest/v1 + /auth/v1.
 */
function normalizeSupabaseUrl(raw: string | undefined | null): string | null {
  const t = raw?.trim()
  if (!t) return null
  try {
    const u = new URL(t)
    u.pathname = ''
    u.search = ''
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return t.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '') || null
  }
}

export const ENV = {
  supabaseUrl: normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || null,
  /** Convex deployment URL — reserved for the documented live-state bridge. */
  convexUrl: (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim() || null,
  orgName: (import.meta.env.VITE_ORG_NAME as string | undefined)?.trim() || 'Boston Traffic Operations (DEMO)',
  orgSlug: 'boston-traffic-ops-demo',
} as const

export const supabaseConfigured = Boolean(ENV.supabaseUrl && ENV.supabaseAnonKey)

/**
 * Demo mode is ONLY the offline fallback: it is available when no Supabase
 * project is configured (the command center must always boot somewhere). When
 * cloud credentials are present the command center requires a real, confirmed
 * Supabase operator session — demo operator sign-in and anonymous auth are
 * never offered. This is a production-deployment rule, not a flag.
 */
export const demoMode = !supabaseConfigured

/**
 * One-click "ENTER DEMO" entry — strictly env-gated and fail-closed.
 *
 * Offered only when the deployment explicitly opts in with
 * VITE_DEMO_MODE=true (the documented demo-organization flag in
 * .env.example). This is a LOCAL session affordance: it reuses the existing
 * clearly-labelled demo operator and local store, and it never mints,
 * bypasses, or weakens a Supabase session. Production deployments that
 * leave the flag unset or false never render the option.
 */
export const demoEntryEnabled =
  (import.meta.env.VITE_DEMO_MODE as string | undefined)?.trim() === 'true'

export const CLOUD_CONFIGURED = supabaseConfigured
