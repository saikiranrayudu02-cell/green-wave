-- ============================================================================
-- GREENWAVE — Fix COALESCE type mismatch in handle_new_user() trigger
--
-- Root cause:
--   COALESCE(text, uuid) is invalid in PostgreSQL — both operands must
--   share a common type. The expression:
--     coalesce(
--       nullif(new.raw_user_meta_data ->> 'org_id', ''),  -- text
--       (select id from public.organizations order by created_at limit 1) -- uuid
--     )::uuid
--   fails with: COALESCE types text and uuid cannot be matched
--
-- Fix: always use the first organization in the table (the demo municipality
-- provisioned by the original seed). The trigger is SECURITY DEFINER, so
-- it runs with owner privileges and the table lookup succeeds.
-- ============================================================================

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
