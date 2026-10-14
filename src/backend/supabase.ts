// ---------------------------------------------------------------------------
// GREENWAVE — Supabase client (production auth + persistence + realtime)
//
// The client is only ever constructed when BOTH VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY exist (see backend/config.ts). Only the publishable
// anon key is used — never a service-role/secret key.
//
// Authentication is email/password with the project's confirmation settings
// (email confirmation remains enforced). There is no anonymous auth and no
// hardcoded demo account. Org membership comes from the `profiles` row the
// handle_new_user trigger creates on sign-up; RLS then scopes every query.
// ---------------------------------------------------------------------------
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { ENV, supabaseConfigured } from './config'

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null
  if (!client) {
    client = createClient(ENV.supabaseUrl!, ENV.supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 8 } },
    })
  }
  return client
}

export type CloudUser = {
  id: string
  email: string
  displayName: string | null
  role: 'ADMIN' | 'TRAFFIC_OPERATOR' | 'EMERGENCY_DISPATCHER' | 'VIEWER' | 'AMBULANCE_DRIVER' | 'HOSPITAL'
  /** org id from the profiles row; null when the org has not been assigned yet */
  orgId: string | null
}

export interface SupabaseAuthResult {
  ok: boolean
  user?: CloudUser
  /** true when the account still needs email confirmation before signing in */
  requiresConfirmation?: boolean
  error?: string
}

const ROLES = ['ADMIN', 'TRAFFIC_OPERATOR', 'EMERGENCY_DISPATCHER', 'VIEWER', 'AMBULANCE_DRIVER', 'HOSPITAL'] as const

interface ProfileRow {
  org_id: string | null
  role: string | null
  display_name: string | null
}

async function profileOf(u: User): Promise<CloudUser> {
  const sb = supabase()
  if (!sb) throw new Error('supabase not configured')
  let profile: ProfileRow | null = null
  try {
    const { data } = await sb.from('profiles').select('org_id, role, display_name').eq('user_id', u.id).maybeSingle()
    profile = (data ?? null) as ProfileRow | null
  } catch {
    profile = null
  }
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>
  const roleRaw = profile?.role ?? meta.role ?? 'VIEWER'
  const role = ROLES.includes(roleRaw as (typeof ROLES)[number]) ? (roleRaw as CloudUser['role']) : 'VIEWER'
  return {
    id: u.id,
    email: u.email ?? '',
    displayName: profile?.display_name ?? (meta.display_name as string | null) ?? null,
    role,
    orgId: profile?.org_id ?? (meta.org_id as string | null) ?? null,
  }
}

export async function supabaseSignIn(email: string, password: string): Promise<SupabaseAuthResult> {
  const sb = supabase()
  if (!sb) return { ok: false, error: 'Supabase is not configured for this deployment.' }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error || !data.user) return { ok: false, error: error?.message ?? 'Sign-in failed.' }
    const user = await profileOf(data.user)
    return { ok: true, user }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sign-in failed.' }
  }
}

/** create an operator account; role is VIEWER until an org admin promotes it */
export async function supabaseSignUp(
  email: string,
  password: string,
  displayName: string,
): Promise<SupabaseAuthResult> {
  const sb = supabase()
  if (!sb) return { ok: false, error: 'Supabase is not configured for this deployment.' }
  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0], role: 'VIEWER' },
      },
    })
    if (error) return { ok: false, error: error.message }
    if (data.session?.user) {
      // auto-confirmed project → session is live immediately
      const user = await profileOf(data.session.user)
      return { ok: true, user }
    }
    if (data.user) {
      // email confirmation required — the operator confirms from their inbox
      return { ok: true, requiresConfirmation: true }
    }
    return { ok: false, error: 'Unable to create the operator account.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sign-up failed.' }
  }
}

export async function supabaseRestore(): Promise<CloudUser | null> {
  const sb = supabase()
  if (!sb) return null
  try {
    const { data } = await sb.auth.getSession()
    if (!data.session?.user) return null
    return await profileOf(data.session.user)
  } catch {
    return null
  }
}

export async function supabaseSignOut(): Promise<void> {
  const sb = supabase()
  if (!sb) return
  try {
    await sb.auth.signOut()
  } catch {
    /* safe */
  }
}
