// ---------------------------------------------------------------------------
// GREENWAVE — operator session (production)
//
// Rules:
//  - A configured Supabase project REQUIRES a real, confirmed email/password
//    session before the command center opens. No anonymous auth, no hardcoded
//    demo credentials, no auto-provisioned accounts.
//  - Demo mode exists only when no cloud is configured: an offline fallback
//    that auto-signs a clearly-labelled DEMO operator so the self-contained
//    demo still boots on a machine with no credentials.
//  - Supabase-js persists the refresh token and auto-refreshes; an expired /
//    revoked session surfaces as SIGNED_OUT and returns the operator to the
//    sign-in gate (see App's onAuthStateChange).
// ---------------------------------------------------------------------------
import type { OpRole } from './types'
import { supabaseConfigured } from './config'
import { supabaseRestore, supabaseSignIn, supabaseSignOut, supabaseSignUp, type CloudUser } from './supabase'

export interface OperatorSession {
  provider: 'demo' | 'supabase'
  operator: string
  role: OpRole
  email?: string
  orgLabel: string
  /** org scope for cloud persistence (bound to the Supabase repository) */
  orgId?: string
  signedInAt: number
}

const KEY = 'gw.session.v1'
const subs = new Set<(s: OperatorSession | null) => void>()

export const DEMO_OPERATORS: { role: OpRole; operator: string; blurb: string }[] = [
  { role: 'EMERGENCY_DISPATCHER', operator: 'A. Reyes', blurb: 'Dispatch · corridor authority' },
  { role: 'TRAFFIC_OPERATOR', operator: 'T. Oliver', blurb: 'Signals · adaptive control' },
  { role: 'ADMIN', operator: 'M. Chen', blurb: 'Operations admin' },
  { role: 'AMBULANCE_DRIVER', operator: 'R. Diaz', blurb: 'Unit A-104 · field driver' },
  { role: 'HOSPITAL', operator: 'Dr. S. Kaur', blurb: 'Emergency receiving' },
  { role: 'VIEWER', operator: 'J. Park', blurb: 'Read-only observer' },
]

export function defaultDemoOperator(): OperatorSession {
  return {
    provider: 'demo',
    operator: 'T. Oliver',
    role: 'TRAFFIC_OPERATOR',
    orgLabel: 'DEMO MUNICIPALITY',
    signedInAt: Date.now(),
  }
}

export function loadSession(): OperatorSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as OperatorSession
      if (s && s.provider && s.role) return s
    }
  } catch {
    /* ignore */
  }
  return null
}

function saveSession(s: OperatorSession | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  subs.forEach((cb) => cb(s))
}

export function onSessionChange(cb: (s: OperatorSession | null) => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

/** offline demo operator sign-in — only valid when no cloud is configured */
export function signInDemo(operator: string, role: OpRole): OperatorSession | null {
  if (supabaseConfigured) return null
  const s: OperatorSession = {
    provider: 'demo',
    operator,
    role,
    orgLabel: 'DEMO MUNICIPALITY',
    signedInAt: Date.now(),
  }
  saveSession(s)
  return s
}

/** real Supabase sign-in (confirmed email/password account) */
export async function signInSupabase(email: string, password: string): Promise<{ ok: boolean; session?: OperatorSession; error?: string }> {
  const res = await supabaseSignIn(email, password)
  if (!res.ok || !res.user) return { ok: false, error: res.error ?? 'Sign-in failed.' }
  const s: OperatorSession = {
    provider: 'supabase',
    operator: res.user.displayName ?? res.user.email.split('@')[0],
    role: res.user.role,
    email: res.user.email,
    orgId: res.user.orgId ?? undefined,
    orgLabel: 'MUNICIPAL NETWORK',
    signedInAt: Date.now(),
  }
  saveSession(s)
  return { ok: true, session: s }
}

export interface SignUpResult {
  ok: boolean
  /** true when a session was returned immediately (auto-confirm) */
  session?: OperatorSession
  /** true when the operator must click the emailed confirmation link first */
  requiresConfirmation?: boolean
  error?: string
}

/** create an operator account (role assigned by the org's admins) */
export async function signUpOperator(email: string, password: string, displayName: string): Promise<SignUpResult> {
  const res = await supabaseSignUp(email, password, displayName)
  if (!res.ok) return { ok: false, error: res.error }
  if (res.requiresConfirmation) return { ok: true, requiresConfirmation: true }
  if (res.user) {
    const s: OperatorSession = {
      provider: 'supabase',
      operator: res.user.displayName ?? res.user.email.split('@')[0],
      role: res.user.role,
      email: res.user.email,
      orgId: res.user.orgId ?? undefined,
      orgLabel: 'MUNICIPAL NETWORK',
      signedInAt: Date.now(),
    }
    saveSession(s)
    return { ok: true, session: s }
  }
  return { ok: false, error: 'Account created — sign in after confirming your email.' }
}

export async function signOutSession(): Promise<void> {
  await supabaseSignOut()
  saveSession(null)
}

function supabaseSessionOf(u: CloudUser, signedInAt: number): OperatorSession {
  return {
    provider: 'supabase',
    operator: u.displayName ?? u.email.split('@')[0],
    role: u.role,
    email: u.email,
    orgId: u.orgId ?? undefined,
    orgLabel: 'MUNICIPAL NETWORK',
    signedInAt,
  }
}

/**
 * Resolve the operator session at boot.
 * Cloud configured: a valid stored Supabase session only — otherwise null and
 * the auth gate is shown. No cloud: the offline demo operator is auto-signed.
 */
export async function resolveBootSession(): Promise<OperatorSession | null> {
  if (supabaseConfigured) {
    const stored = loadSession()
    const cloud = await supabaseRestore()
    if (!cloud) {
      if (stored?.provider === 'supabase') saveSession(null) // revoked/expired
      return null
    }
    const s = supabaseSessionOf(cloud, stored?.provider === 'supabase' ? stored.signedInAt : Date.now())
    saveSession(s)
    return s
  }
  // offline demo fallback
  const stored = loadSession()
  if (stored?.provider === 'demo') return stored
  const d = defaultDemoOperator()
  saveSession(d)
  return d
}

export type { CloudUser }
