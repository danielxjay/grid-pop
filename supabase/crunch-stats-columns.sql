alter table public.crunch_runs
  add column if not exists verified_move_count integer,
  add column if not exists verified_wall_depth integer,
  add column if not exists verified_lines_cleared integer,
  add column if not exists verified_best_lines_cleared integer,
  add column if not exists verified_wall_cells_cleared integer,
  add column if not exists verified_time_bonus_ms integer,
  add column if not exists verified_critical_escapes integer;

alter table public.crunch_scores
  add column if not exists move_count integer,
  add column if not exists wall_depth integer,
  add column if not exists lines_cleared integer,
  add column if not exists best_lines_cleared integer,
  add column if not exists wall_cells_cleared integer,
  add column if not exists time_bonus_ms integer,
  add column if not exists critical_escapes integer;
