create table if not exists public.feature_flags (
  flag_key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flag_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  flag_key text not null references public.feature_flags(flag_key) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, flag_key)
);

alter table public.feature_flags enable row level security;
alter table public.feature_flag_overrides enable row level security;

drop policy if exists "authenticated users can read global feature flags" on public.feature_flags;
create policy "authenticated users can read global feature flags"
on public.feature_flags
for select
to authenticated
using (true);

drop policy if exists "users can read their own feature flag overrides" on public.feature_flag_overrides;
create policy "users can read their own feature flag overrides"
on public.feature_flag_overrides
for select
to authenticated
using (auth.uid() = user_id);

insert into public.feature_flags (flag_key, enabled)
values ('crunch_mode', false)
on conflict (flag_key) do update
set enabled = excluded.enabled,
    updated_at = now();

-- Example tester rollout:
-- insert into public.feature_flag_overrides (user_id, flag_key, enabled)
-- values ('00000000-0000-0000-0000-000000000000', 'crunch_mode', true)
-- on conflict (user_id, flag_key) do update
-- set enabled = excluded.enabled,
--     updated_at = now();
