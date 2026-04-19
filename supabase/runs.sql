create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  seed text not null,
  status text not null check (status in ('active', 'submitted', 'verified', 'rejected')),
  moves jsonb not null default '[]'::jsonb,
  verified_score integer,
  rejection_reason text,
  client_version text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists runs_user_id_started_at_idx
  on public.runs (user_id, started_at desc);

create index if not exists runs_status_started_at_idx
  on public.runs (status, started_at desc);

alter table public.runs enable row level security;
revoke all on table public.runs from anon, authenticated;
grant select on table public.runs to authenticated;

drop policy if exists "users can read their own runs" on public.runs;
create policy "users can read their own runs"
on public.runs
for select
to authenticated
using ((select auth.uid()) = user_id);

alter table public.scores
add column if not exists run_id uuid references public.runs(id) on delete set null;

create unique index if not exists scores_run_id_idx
  on public.scores (run_id)
  where run_id is not null;
