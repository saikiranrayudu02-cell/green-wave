// ---------------------------------------------------------------------------
// GREENWAVE — cloud binding
//
// Once the operator has a valid Supabase session the active repository is the
// Supabase repository (org-bound, RLS-scoped). Without one — no cloud, signed
// out, expired session — the local demo store is the active repository.
// SupabaseRepository itself falls back to the local store whenever a remote
// call fails, so a cloud outage degrades instead of halting the command
// center.
// ---------------------------------------------------------------------------
import { supabaseConfigured } from './config'
import { supabaseRestore } from './supabase'
import { supabaseRepository } from './supabaseRepo'
import { localRepository, setActiveRepository } from './repo'
import { liveBus } from './live'

let bound = false

export function cloudSessionActive(): boolean {
  return bound
}

/**
 * Bind the Supabase repository when a real cloud session is present.
 * Returns true when the cloud repo became the active store.
 */
export async function ensureCloudSession(): Promise<boolean> {
  if (!supabaseConfigured) return false
  if (bound) return true
  const user = await supabaseRestore()
  if (!user) return false
  const repo = supabaseRepository()
  repo.bindOrg(user.orgId)
  setActiveRepository(repo)
  liveBus().attachRealtime()
  bound = true
  void repo.ping() // flips the DATABASE indicator to SYNCED / DEGRADED
  return true
}

/** revert to the fully local demo store (sign-out / session expiry) */
export function releaseCloudSession(): void {
  if (!bound) return
  bound = false
  liveBus().detachRealtime()
  setActiveRepository(localRepository())
}
