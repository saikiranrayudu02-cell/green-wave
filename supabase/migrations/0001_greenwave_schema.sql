-- ============================================================================
-- GREENWAVE — persistent operational schema (Step 6)
--
-- Supabase is the *persistent system of record* for GreenWave:
--   organizations · profiles · emergencies · incidents · simulation sessions
--   signal decision logs · emergency metrics · simulation benchmarks
--
-- Live, high-frequency traffic state stays in the browser simulation engine;
-- this schema stores meaningful operational records + audit history.
-- All tables are row-level-security protected by organization membership.
-- ============================================================================

create extension if not exists pgcrypto; -- gen_random_uuid

-- ---------------------------------------------------------------------------
-- organizations (municipalities / demo municipality)
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles (one per auth.users row; holds org + operational role)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  role         text not null default 'VIEWER'
               check (role in ('ADMIN', 'TRAFFIC_OPERATOR', 'EMERGENCY_DISPATCHER', 'VIEWER')),
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- every new auth user gets a profile (org assigned by the caller / demo seed)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, org_id, role, display_name)
  values (
    new.id,
    (
      select id from public.organizations order by created_at limit 1
    )::uuid,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'VIEWER'),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- emergencies
-- ---------------------------------------------------------------------------
create table if not exists public.emergencies (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations (id) on delete cascade,
  emergency_ref            text not null,               -- human label, e.g. "EM-1042"
  unit                     text,                        -- ambulance unit, e.g. "A-104"
  code                     text not null default 'MEDICAL', -- MEDICAL | TRAUMA
  priority                 text not null default 'CRITICAL',-- CRITICAL | HIGH
  incident                 text,
  origin                   text,
  destination              text,
  origin_intersection_id   text,
  destination_intersection_id text,
  route_intersection_ids   jsonb not null default '[]'::jsonb, -- machine-readable route
  route_road_ids           jsonb not null default '[]'::jsonb,
  distance_km              numeric,
  baseline_sec             integer,
  status                   text not null default 'PENDING'
                           check (status in ('PENDING', 'EN_ROUTE', 'ARRIVED', 'COMPLETED')),
  corridor_active          boolean not null default false,
  corridor_opened_at       timestamptz,
  dispatched_at            timestamptz,
  arrived_at               timestamptz,
  signal_wait_sec          numeric not null default 0,  -- real simulated wait at signals
  saved_sec                integer not null default 0,  -- simulated corridor gain
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_emergencies_org_created
  on public.emergencies (org_id, created_at desc);
create index if not exists idx_emergencies_status
  on public.emergencies (status);

-- ---------------------------------------------------------------------------
-- incidents
-- ---------------------------------------------------------------------------
create table if not exists public.incidents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  junction_id text not null,
  label       text,
  severity    text not null default 'HIGH' check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status      text not null default 'ACTIVE' check (status in ('ACTIVE', 'RESOLVED')),
  started_at  timestamptz not null default now(),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_incidents_org_created
  on public.incidents (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- simulation sessions (one per demo run / operator console session)
-- ---------------------------------------------------------------------------
create table if not exists public.simulation_sessions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  mode        text not null default 'FIXED_TIME',       -- FIXED_TIME | GREENWAVE | EMERGENCY_CORRIDOR
  seed        text,
  status      text not null default 'RUNNING' check (status in ('RUNNING', 'ENDED')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_sessions_org_created
  on public.simulation_sessions (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- signal decision logs (audit trail — why did the system change this signal?)
-- ---------------------------------------------------------------------------
create table if not exists public.signal_decision_logs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  sim_t          integer not null default 0,            -- simulation clock (s)
  junction_id    text not null,
  mode           text not null default 'GREENWAVE',     -- FIXED_TIME | GREENWAVE
  decision_type  text not null default 'NORMAL_ADAPTIVE'
                 check (decision_type in (
                   'NORMAL_ADAPTIVE', 'PHASE_EXTENSION', 'PHASE_CHANGE',
                   'EMERGENCY_PRIORITY', 'CORRIDOR_PREPARATION',
                   'CORRIDOR_ACTIVE', 'CORRIDOR_RELEASE', 'INCIDENT_RESPONSE'
                 )),
  previous_phase text,
  selected_phase text not null,
  pressure       numeric not null default 0,
  other_pressure numeric not null default 0,
  queue          integer not null default 0,
  approaching    integer not null default 0,
  reason         text,
  emergency_id   uuid,                                  -- set when an emergency context applies
  created_at     timestamptz not null default now()
);

create index if not exists idx_decisions_org_created
  on public.signal_decision_logs (org_id, created_at desc);
create index if not exists idx_decisions_junction
  on public.signal_decision_logs (junction_id, created_at desc);
create index if not exists idx_decisions_emergency
  on public.signal_decision_logs (emergency_id);

-- ---------------------------------------------------------------------------
-- emergency metrics (finalized on arrival — real simulated numbers only)
-- ---------------------------------------------------------------------------
create table if not exists public.emergency_metrics (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  emergency_id         uuid references public.emergencies (id) on delete cascade,
  baseline_eta_sec     integer,
  travel_sec           integer,                          -- actual elapsed travel
  signal_wait_sec      numeric not null default 0,       -- actual time stopped at signals
  intersections_passed integer not null default 0,
  delay_avoided_sec    integer not null default 0,       -- baseline − actual signal delay (simulated)
  created_at           timestamptz not null default now()
);

create index if not exists idx_emergency_metrics_org
  on public.emergency_metrics (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- simulation benchmarks (fixed-time baseline vs adaptive, same deterministic
-- scenario — only real harness numbers may be written)
-- ---------------------------------------------------------------------------
create table if not exists public.simulation_benchmarks (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  session_id         uuid references public.simulation_sessions (id) on delete set null,
  baseline_mode      text not null default 'FIXED_TIME',
  adaptive_mode      text not null default 'GREENWAVE',
  baseline_wait      numeric not null default 0,
  adaptive_wait      numeric not null default 0,
  baseline_speed     numeric not null default 0,
  adaptive_speed     numeric not null default 0,
  baseline_queue     numeric not null default 0,
  adaptive_queue     numeric not null default 0,
  baseline_throughput numeric not null default 0,
  adaptive_throughput numeric not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists idx_benchmarks_org_created
  on public.simulation_benchmarks (org_id, created_at desc);

-- ===========================================================================
-- Row Level Security — organization isolation. A user may only ever read or
-- write records that belong to the organization of their profile.
-- ===========================================================================
alter table public.organizations          enable row level security;
alter table public.profiles               enable row level security;
alter table public.emergencies            enable row level security;
alter table public.incidents              enable row level security;
alter table public.simulation_sessions    enable row level security;
alter table public.signal_decision_logs   enable row level security;
alter table public.emergency_metrics      enable row level security;
alter table public.simulation_benchmarks  enable row level security;

-- helper: org of the signed-in user (profiles are org-scoped themselves)
create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select org_id from public.profiles where user_id = auth.uid()
$$;

-- organizations: authenticated users may see their own organization row
create policy "org_select_own" on public.organizations
  for select to authenticated
  using (id = public.current_org_id());

-- profiles: users read/update their own profile; admins manage their org's
create policy "profile_select_own" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.current_org_id() = org_id);

create policy "profile_insert_own" on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "profile_update_own" on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- operational tables: org-scoped access for authenticated members
do $$
declare
  t text;
begin
  foreach t in array array[
    'emergencies', 'incidents', 'simulation_sessions',
    'signal_decision_logs', 'emergency_metrics', 'simulation_benchmarks'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (org_id = public.current_org_id())',
      t || '_org_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (org_id = public.current_org_id())',
      t || '_org_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (org_id = public.current_org_id()) with check (org_id = public.current_org_id())',
      t || '_org_update', t);
  end loop;
end;
$$;

-- ===========================================================================
-- Demo municipality seed (idempotent)
-- ===========================================================================
insert into public.organizations (name, slug)
values ('Boston Traffic Operations (DEMO)', 'boston-traffic-ops-demo')
on conflict (slug) do nothing;
