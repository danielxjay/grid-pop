alter table public.scores
  add column if not exists move_count integer,
  add column if not exists best_combo integer,
  add column if not exists best_move_score integer,
  add column if not exists best_lines_cleared integer;

-- Retroactively populate move_count from the moves array on verified runs.
-- best_combo and best_move_score require a replay script (backfill-stats.ts).
update public.scores s
set move_count = jsonb_array_length(r.moves)
from public.runs r
where r.id = s.run_id
  and s.run_id is not null
  and s.move_count is null;
