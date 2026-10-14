# GREENWAVE — Live Operational Backend (Steps 6 + 7)

GreenWave's traffic simulation runs entirely in the browser. Steps 6+7 add the
operational layer around it:

- **Authentication** — production Supabase Auth (email/password, confirmation
  enforced). No anonymous auth, no hardcoded demo credentials.
- **Persistent operational data** — emergencies, emergency metrics, incidents,
  sessions, signal decision logs, benchmarks (system of record in Supabase).
- **Live operational state** — real-time command-center state via Convex
  (emergency, corridor, signals, snapshots, decisions).
- **Real-time state synchronization** — aggregated snapshots shared between
  command-center windows (throttled, never per-vehicle-frame).
- **Simulation session management** — every operator session is audited.

```
                    GREENWAVE FRONTEND
                           │
             ┌─────────────┼─────────────┐
             ↓             ↓             ↓
           CONVEX       SUPABASE     LOCAL BUS
      live operational   persistent   cross-window
         state         records + RLS  BroadcastChannel
      (HTTP mutations   (PostgREST)
       + optional WS)
```

## Authentication rules (production)

1. When `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are present, the command
   center **requires a confirmed Supabase email/password session**. Demo
   operator sign-in and anonymous auth are never offered in this mode.
2. Email confirmation stays enabled (per project settings); sign-up sends a
   confirmation link the operator must verify once.
3. Only the publishable anon key is used by the Vite frontend. Never set a
   service-role/secret key in frontend code or `.env`.
4. Session lifecycle is handled by supabase-js (`autoRefreshToken`, persisted
   refresh token) plus an `onAuthStateChange` listener: `SIGNED_OUT` (logout,
   revoked or expired token) returns the operator to the auth gate.
5. Organization isolation is enforced by **row-level security** on every
   operational table: reads/writes are scoped to `org_id =
   current_org_id()` of the signed-in user's profile.
6. Demo mode is only the **offline fallback**: with no cloud credentials the
   app auto-signs a clearly-labelled DEMO operator so the self-contained demo
   still boots on a machine with no `.env`. Remove/blank the Supabase
   credentials to see this path.

## What owns what

| Data | Source of truth | Transport |
| --- | --- | --- |
| Vehicle animation / sim metrics | local engine (`src/engine/`) | — |
| Aggregated live operational snapshot | local engine, published ~2 s | HTTP → Convex + BroadcastChannel |
| Active emergency / corridor / signals | local engine, event-driven | HTTP → Convex |
| Signal decision events | local engine, meaningful changes only | HTTP → Convex |
| Persistent emergencies / incidents / decisions / sessions / metrics | **Supabase** (falls back to local store on failure) | PostgREST via anon client |
| Operator session | Supabase Auth | auth tokens |

## Modules (`src/backend/`)

- `config.ts` — environment resolution. Cloud features are **closed by
  default**: nothing reaches the network unless both Supabase vars are set.
  A pasted `…/rest/v1/` URL is normalized to the project origin.
- `supabase.ts` — guarded Supabase client; email/password sign-in, sign-up
  (confirmation aware), session restore, profile/org resolution. Anon key only.
- `session.ts` — operator session model: real Supabase session when cloud is
  configured, offline demo operator otherwise.
- `cloud.ts` — binds the Supabase repository once a real session exists;
  releases it back to the local store on sign-out/expiry.
- `repo.ts` — `OpsRepository` interface, `LocalRepository` (localStorage demo
  store), DB-health hub, decision classification.
- `supabaseRepo.ts` — `SupabaseRepository`: the same contract over PostgreSQL.
  Org-bound and RLS-scoped. Failures degrade the status indicator and fall
  back to the local store — the command center never stalls.
- `live.ts` — live-sync bus: `BroadcastChannel` always on, Supabase Realtime
  broadcast when a cloud session is active.
- `convex.ts` — **Convex live-state bridge**: HTTP mutations for all
  operational events (snapshots, emergencies, corridors, signals, decisions),
  optional WebSocket client for realtime subscriptions. Fails closed to
  OFFLINE · LOCAL when the deployment is unreachable.

## Supabase setup

1. `npm i @supabase/supabase-js` (already a dependency).
2. Apply `supabase/migrations/0001_greenwave_schema.sql` once (Supabase SQL
   editor). It creates the schema, RLS policies, indexes, the
   `handle_new_user` profile trigger, and seeds the demo municipality
   `Boston Traffic Operations (DEMO)`.
3. If user creation fails with `COALESCE types text and uuid cannot be matched`,
   apply `supabase/migrations/0002_fix_coalesce_trigger.sql` to fix the
   trigger.
4. Copy `.env.example` → `.env` and fill `VITE_SUPABASE_URL` (the project
   origin, e.g. `https://<ref>.supabase.co`) and `VITE_SUPABASE_ANON_KEY`.
   Do **not** paste `…/rest/v1/` into the URL — the app normalizes it anyway.
5. Keep email confirmation enabled in Authentication → Providers → Email.

Tables: `organizations`, `profiles`, `emergencies`, `incidents`,
`simulation_sessions`, `signal_decision_logs`, `emergency_metrics`,
`simulation_benchmarks`. Routes are stored machine-readable
(`route_intersection_ids`, `route_road_ids` JSON arrays).

## Convex setup

1. `npm i convex` (already a dependency).
2. The Convex deployment is live at `VITE_CONVEX_URL` (set in `.env`).
3. Server functions are in `convex/functions.ts` with schema in
   `convex/schema.ts`.
4. The deployment was initialized via `initDeployment` with `demoMode: true`
   and the demo municipality `org-demo-boston` registered.
5. For production identity verification:
   - Configure a custom JWT auth provider in Convex dashboard
     (Settings → Auth → Custom JWT → point at Supabase JWKS)
   - Provision operators via `npx convex run functions:addOperator`
     with the bootstrap key
   - The `orgFor()` function in `convex/functions.ts` will then verify
     identities against the `opsMembers` table

### Convex tables (live operational state)

| Table | Purpose | Lifecycle |
| --- | --- | --- |
| `orgs` | Registered municipalities | Provisioned once |
| `opsMembers` | Identity → org mapping (production) | Provisioned once |
| `deploymentConfig` | Demo-trust gate | Provisioned once |
| `liveSnapshots` | Aggregated traffic metrics (~2 s) | Replaced per source |
| `liveSignals` | Per-intersection signal state | Patched on change |
| `activeEmergencies` | Current emergency state | Inserted on dispatch, cleared on reset |
| `activeIncidents` | Active incidents | Inserted on inject, patched on resolve |
| `corridorStates` | Green corridor coordination | Inserted on arm, patched on transitions |
| `decisionEvents` | Audit trail (capped, 200/org) | Appended on meaningful changes |

### Convex mutations (all org-scoped)

| Mutation | Called when |
| --- | --- |
| `publishSnapshot` | Every ~2 s (aggregated metrics) |
| `publishEmergency` | Dispatch, corridor arm, arrival |
| `clearEmergency` | Reset |
| `publishIncident` | Incident inject |
| `resolveIncident` | Incident clear |
| `publishCorridor` | Corridor arm, wave transitions, arrival |
| `clearCorridor` | Reset |
| `publishDecision` | Signal phase changes, corridor events |
| `clearOrgLiveState` | Reset, sign-out |

## Operator accounts

New operators sign up in the app (Create Account) and verify the confirmation
email — the `handle_new_user` trigger provisions their `profiles` row into the
first organization with role `VIEWER`. An org admin promotes roles
(`TRAFFIC_OPERATOR` / `EMERGENCY_DISPATCHER` / `ADMIN`) by updating the
`profiles` table. Supabase Table Editor is one way to do that:

```sql
update public.profiles
set role = 'TRAFFIC_OPERATOR'
where user_id = '<auth-user-uuid>';
```

## Failure handling

- **Supabase unreachable** / RLS-denied / schema drift → writes fall back to
  the local store, DATABASE shows **DEGRADED**, the simulation continues.
- **Convex unreachable** → mutations silently degrade (HTTP 400/500 absorbed),
  CONVEX chip shows **OFFLINE · LOCAL**, the simulation continues.
- **WebSocket blocked** → HTTP mutations still work (fire-and-forget),
  CONVEX shows **LIVE · DEMO**. Subscriptions are a bonus, not required.
- **Both clouds down** → fully local demo with BroadcastChannel cross-window
  sync. The command center never depends on any cloud service.
- Realtime channel down → LIVE SYNC shows **DEGRADED**; the local bus keeps
  multi-window sync.
- No cloud at all → DATABASE `LOCAL STORE`, LIVE SYNC `CONNECTED · LOCAL BUS`.
- Expired / revoked session → `SIGNED_OUT` returns the operator to the gate.
- History is never silently erased: RESET ends the simulation session and opens
  a new one; records persist. Use the LOG drawer's clear action to wipe local
  history only (remote rows are protected).

## Demo reliability (3 tiers)

| Mode | Simulation | Convex | Supabase | Status chips |
| --- | --- | --- | --- | --- |
| LIVE MODE | ✅ | HTTP mutations + WS subs | ✅ Auth + persistence | SIMULATION · LOCAL ENGINE, DEMO · CONVEX, SYNCED · SUPABASE |
| DEGRADED MODE | ✅ | HTTP only (WS blocked) | ✅ Auth + persistence | SIMULATION · LOCAL ENGINE, LIVE · CONVEX, SYNCED · SUPABASE |
| OFFLINE DEMO | ✅ | — | — | SIMULATION · LOCAL ENGINE, CONVEX OFF, LOCAL STORE |

## Verifying the real connection

### Supabase

1. Create + confirm an operator (dashboard **Authentication → Users → Add
   user**, or in-app sign-up with the confirmation email).
2. Open the command center and sign in with that account.
3. The DATABASE indicator flips to `SYNCED · SUPABASE`.
4. Run the demo: Dispatch Emergency → Open Green Corridor → Inject Incident →
   reroute → Ambulance Arrival → Reset.
5. Check Supabase Table Editor: `emergencies` (EN_ROUTE → ARRIVED with real
   route stats), `emergency_metrics` (finalized on arrival),
   `signal_decision_logs` (adaptive + corridor events), `incidents` (ACTIVE →
   RESOLVED), `simulation_sessions` (RUNNING → ENDED).

### Convex

1. The CONVEX chip shows `DEMO · CONVEX` (HTTP connected, demo-trust mode).
2. Run the demo: snapshots, decisions, emergency, corridor events all publish
   to Convex in real-time.
3. Check via HTTP API or Convex dashboard: `liveSnapshots` (aggregated metrics),
   `decisionEvents` (signal changes), `activeEmergencies` (dispatch → arrived),
   `corridorStates` (ACTIVE → RELEASED).
4. Org isolation: requests with wrong `orgId` return `UNAUTHORIZED`.

An unauthenticated client (no session, anon role) receives an empty result for
every org-owned table — RLS denies before any data leaves PostgREST.
