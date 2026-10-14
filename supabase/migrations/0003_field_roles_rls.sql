-- ============================================================================
-- GREENWAVE — field roles (Ambulance Driver, Hospital) + least-privilege RLS
--
-- Extends the operator role set with two REAL authenticated field roles and
-- tightens access for them. This migration is PURELY ADDITIVE / RESTRICTIVE:
--   · it never drops or loosens the existing org-isolation policies from 0001;
--   · new limits are RESTRICTIVE policies, which AND with the existing
--     permissive org policies (a field role is still org-scoped AND further
--     limited) — org isolation can only get stronger, never weaker.
--
-- Least-privilege model (feature: security / minimum-necessary information):
--   AMBULANCE_DRIVER, HOSPITAL
--     · may READ their org's operational records (unchanged org policy)
--     · may NOT INSERT/UPDATE operational tables (read-only field consoles)
--     · may only SELECT their OWN profile row (not the whole org roster)
--   ADMIN / TRAFFIC_OPERATOR / EMERGENCY_DISPATCHER / VIEWER: unchanged.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. allow the two new roles in the profiles role CHECK constraint
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'ADMIN', 'TRAFFIC_OPERATOR', 'EMERGENCY_DISPATCHER', 'VIEWER',
    'AMBULANCE_DRIVER', 'HOSPITAL'
  ));

-- ---------------------------------------------------------------------------
-- 2. helper: the operational role of the signed-in user
-- ---------------------------------------------------------------------------
create or replace function public.current_op_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 3. profiles: field roles may only see THEIR OWN profile row
--    (restrictive → ANDs with the existing permissive profile_select_own)
-- ---------------------------------------------------------------------------
drop policy if exists "profile_field_role_scope" on public.profiles;
create policy "profile_field_role_scope" on public.profiles
  as restrictive for select to authenticated
  using (
    public.current_op_role() not in ('AMBULANCE_DRIVER', 'HOSPITAL')
    or user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- 4. operational tables: field roles are READ-ONLY (no insert / update)
--    (restrictive → ANDs with the existing permissive org insert/update)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'emergencies', 'incidents', 'simulation_sessions',
    'signal_decision_logs', 'emergency_metrics', 'simulation_benchmarks'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_field_role_no_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated '
      || 'with check (public.current_op_role() not in (''AMBULANCE_DRIVER'', ''HOSPITAL''))',
      t || '_field_role_no_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_field_role_no_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated '
      || 'using (public.current_op_role() not in (''AMBULANCE_DRIVER'', ''HOSPITAL'')) '
      || 'with check (public.current_op_role() not in (''AMBULANCE_DRIVER'', ''HOSPITAL''))',
      t || '_field_role_no_update', t);
  end loop;
end;
$$;
