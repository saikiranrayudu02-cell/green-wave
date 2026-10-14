# Convex live-state bridge

GreenWave's **high-frequency traffic simulation stays local** (browser). The
Convex layer carries *aggregated operational state* — snapshots, active
emergencies, corridor coordination, signal states, and decision events —
published via HTTP mutations (~2 s snapshots, event-driven for emergencies).

## Deployment status

The Convex deployment is **live** at the URL in `VITE_CONVEX_URL`.
Server functions are deployed in `convex/functions.ts`.
Schema is in `convex/schema.ts`.

The deployment was initialized with `initDeployment`:
- `demoMode: true` — demo-trust org validation is active
- `org-demo-boston` is the registered demo municipality

`convex.json` is not committed (it's in `.gitignore`). To deploy changes:

```bash
# Option A: with a deploy key (CI / manual)
CONVEX_DEPLOY_KEY=<key> npx convex deploy

# Option B: with a linked project (interactive)
npx convex dev   # watches for changes and deploys to dev
```

## Organization isolation

Every mutation/query enforces org isolation server-side via `orgFor()`:

1. **Production tier** (identity verified): `ctx.auth.getUserIdentity()`
   resolves the caller's org from the `opsMembers` table (subject → orgId).
   Requires a custom JWT auth provider configured in the Convex dashboard
   pointing at Supabase's JWKS endpoint.

2. **Demo tier** (current mode): When no identity is present but
   `deploymentConfig.demoMode === true`, the claimed `orgId` is accepted
   ONLY if it's a registered municipality in the `orgs` table. Arbitrary
   org identifiers are rejected.

3. **All other cases**: `UNAUTHORIZED` error.

## Production identity verification

To move from demo-trust to verified identity:

1. In the Convex dashboard, configure a **Custom JWT auth provider**:
   - JWKS URL: `https://<supabase-ref>.supabase.co/auth/v1/.well-known/jwks.json`
   - Or: `https://<supabase-ref>.supabase.co/auth/v1/issuer`

2. Provision operators via the admin CLI (requires `CONVEX_BOOTSTRAP_KEY`):
   ```bash
   npx convex run functions:addOperator \
     --bootstrapKey <key> \
     --subject <supabase-user-uuid> \
     --orgId <org-uuid> \
     --label "Traffic Operator"
   ```

3. On the frontend, the Supabase JWT is automatically attached via
   `client.setAuth()` when the deployment has an auth provider configured.
   No client code changes needed.

## Server functions

| Function | Type | Purpose |
| --- | --- | --- |
| `initDeployment` | mutation | One-time setup (bootstrap key required) |
| `addOperator` | mutation | Provision identity → org mapping |
| `removeOperator` | mutation | Remove operator |
| `publishSnapshot` | mutation | Aggregated traffic metrics (~2 s) |
| `latestSnapshot` | query | Latest snapshot for an org |
| `publishEmergency` | mutation | Active emergency state |
| `clearEmergency` | mutation | Remove emergency on reset |
| `latestEmergency` | query | Latest emergency for an org |
| `publishIncident` | mutation | Active incident state |
| `resolveIncident` | mutation | Mark incident resolved |
| `activeIncidents` | query | All incidents for an org |
| `publishCorridor` | mutation | Green corridor coordination |
| `clearCorridor` | mutation | Remove corridor on reset |
| `latestCorridor` | query | Latest corridor for an org |
| `publishSignal` | mutation | Per-intersection signal state |
| `signalStates` | query | All signal states for an org |
| `publishDecision` | mutation | Audit trail event (capped at 200/org) |
| `decisionEvents` | query | Recent decisions for an org |
| `deploymentStatus` | query | Non-sensitive deployment info |
| `clearOrgLiveState` | mutation | Reset all live state for an org |

## Frontend bridge (`src/backend/convex.ts`)

The bridge uses **dual transport**:

- **HTTP POST** (`/api/mutation`): All mutations go through HTTP. Always works
  regardless of WebSocket availability. Fire-and-forget (never blocks the
  simulation).
- **WebSocket** (`ConvexClient`): Optional subscription for realtime updates.
  When WebSocket is blocked (firewalls, preview panes), HTTP still works and
  the CONVEX chip shows LIVE · DEMO.

The bridge is activated when `VITE_CONVEX_URL` is set. It reports health
through `onConvexHealth()` which drives the CONVEX status chip in the TopBar.
