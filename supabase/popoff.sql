-- PopOff progress: one row per user, stores best move count per puzzle (null = not yet solved)
create table if not exists public.popoff_progress (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  best_by_puzzle jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.popoff_progress enable row level security;

drop policy if exists "users can read own popoff progress" on public.popoff_progress;
create policy "users can read own popoff progress"
on public.popoff_progress
for select
to authenticated
using (auth.uid() = user_id);

-- INSERT and UPDATE are intentionally not granted to authenticated users.
-- All writes go through the submit-popoff-solution edge function which uses
-- the service role key and validates solutions server-side before writing.

-- Feature flag for PopOff game mode and leaderboard (off by default — enable per user or globally when ready)
insert into public.feature_flags (flag_key, enabled)
values ('popoff_mode', true)
on conflict (flag_key) do update
set enabled = excluded.enabled,
    updated_at = now();

-- Example: enable for a specific tester
-- insert into public.feature_flag_overrides (user_id, flag_key, enabled)
-- values ('00000000-0000-0000-0000-000000000000', 'popoff_mode', true)
-- on conflict (user_id, flag_key) do update
-- set enabled = excluded.enabled,
--     updated_at = now();
