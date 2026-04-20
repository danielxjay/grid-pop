/**
 * One-shot backfill function. Deploy, call once with the service role key, then delete.
 *
 * curl -X POST https://your-project.supabase.co/functions/v1/backfill-stats \
 *   -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const GRID_SIZE = 8;
const TRAY_SIZE = 3;
const TONES = ["coral", "gold", "mint", "sky", "orchid"];
const SHAPES = [
  { name: "single", cells: [[0, 0]] },
  { name: "bar-2", cells: [[0, 0], [1, 0]] },
  { name: "bar-3", cells: [[0, 0], [1, 0], [2, 0]] },
  { name: "bar-4", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: "bar-5", cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { name: "col-2", cells: [[0, 0], [0, 1]] },
  { name: "col-3", cells: [[0, 0], [0, 1], [0, 2]] },
  { name: "col-4", cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { name: "square-2", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: "square-3", cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]] },
  { name: "l-3", cells: [[0, 0], [0, 1], [1, 1]] },
  { name: "l-4", cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: "j-4", cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
  { name: "t-4", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: "zig-4", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { name: "s-4", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: "step-5", cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
] as const;

type BoardCell = { tone: string; groupId: number } | null;
type Piece = { id: number; shape: (typeof SHAPES)[number]; tone: string; bounds: { width: number; height: number } };
type GameState = {
  board: BoardCell[];
  tray: Array<Piece | null>;
  nextPieceId: number;
  rngState: number;
  score: number;
  bestScore: number;
  combo: number;
  selectedPieceId: number | null;
  preview: null;
  gameOver: boolean;
  cleared: number[];
  clearedTones: Record<number, string>;
};
type Move = { pieceId: number; row: number; col: number };

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0 || 1;
}

function nextRandomValue(rngState: number) {
  const state = (rngState + 0x6d2b79f5) >>> 0;
  let value = Math.imul(state ^ (state >>> 15), state | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { rngState: state, value: ((value ^ (value >>> 14)) >>> 0) / 4294967296 };
}

function toIndex(row: number, col: number) { return row * GRID_SIZE + col; }
function getShapeBounds(shape: (typeof SHAPES)[number]) {
  return { width: Math.max(...shape.cells.map(([dx]) => dx)) + 1, height: Math.max(...shape.cells.map(([, dy]) => dy)) + 1 };
}
function canPlace(board: BoardCell[], piece: Piece, row: number, col: number) {
  return piece.shape.cells.every(([dx, dy]) => {
    const r = row + dy, c = col + dx;
    return r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE && board[toIndex(r, c)] === null;
  });
}
function hasAnyPlacement(board: BoardCell[], piece: Piece) {
  for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) if (canPlace(board, piece, r, c)) return true;
  return false;
}
function hasPotentialMove(board: BoardCell[]) {
  return SHAPES.some((shape) => hasAnyPlacement(board, { id: -1, shape, tone: TONES[0], bounds: getShapeBounds(shape) }));
}
function createRandomPiece(nextPieceId: number, rngState: number) {
  const shapePick = nextRandomValue(rngState);
  const tonePick = nextRandomValue(shapePick.rngState);
  const shape = SHAPES[Math.floor(shapePick.value * SHAPES.length) % SHAPES.length];
  const tone = TONES[Math.floor(tonePick.value * TONES.length) % TONES.length];
  return { piece: { id: nextPieceId, shape, tone, bounds: getShapeBounds(shape) }, nextPieceId: nextPieceId + 1, rngState: tonePick.rngState };
}
function buildTray(board: BoardCell[], nextPieceId: number, rngState: number) {
  let tray: Piece[] = [];
  let currentPieceId = nextPieceId;
  let currentRngState = rngState;
  for (let slot = 0; slot < TRAY_SIZE; slot++) {
    const p = createRandomPiece(currentPieceId, currentRngState);
    tray.push(p.piece); currentPieceId = p.nextPieceId; currentRngState = p.rngState;
  }
  if (hasPotentialMove(board)) {
    let attempts = 0;
    while (attempts < 40 && !tray.some((p) => hasAnyPlacement(board, p))) {
      tray = []; currentPieceId = nextPieceId;
      for (let slot = 0; slot < TRAY_SIZE; slot++) {
        const p = createRandomPiece(currentPieceId, currentRngState);
        tray.push(p.piece); currentPieceId = p.nextPieceId; currentRngState = p.rngState;
      }
      attempts++;
    }
  }
  return { tray, nextPieceId: currentPieceId, rngState: currentRngState };
}
function createGameState(seed: string): GameState {
  const board = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => null as BoardCell);
  const initialRngState = hashSeed(seed);
  const { tray, nextPieceId, rngState } = buildTray(board, 1, initialRngState);
  return { board, tray, nextPieceId, rngState, score: 0, bestScore: 0, combo: 0, selectedPieceId: null, preview: null, gameOver: false, cleared: [], clearedTones: {} };
}
function findClears(board: BoardCell[]) {
  const cleared = new Set<number>();
  for (let row = 0; row < GRID_SIZE; row++) {
    const idx = Array.from({ length: GRID_SIZE }, (_, col) => toIndex(row, col));
    if (idx.every((i) => board[i] !== null)) idx.forEach((i) => cleared.add(i));
  }
  for (let col = 0; col < GRID_SIZE; col++) {
    const idx = Array.from({ length: GRID_SIZE }, (_, row) => toIndex(row, col));
    if (idx.every((i) => board[i] !== null)) idx.forEach((i) => cleared.add(i));
  }
  return cleared;
}
function countLines(clearedIndices: Set<number>) {
  let lines = 0;
  for (let row = 0; row < GRID_SIZE; row++) {
    if (Array.from({ length: GRID_SIZE }, (_, col) => toIndex(row, col)).every((i) => clearedIndices.has(i))) lines++;
  }
  for (let col = 0; col < GRID_SIZE; col++) {
    if (Array.from({ length: GRID_SIZE }, (_, row) => toIndex(row, col)).every((i) => clearedIndices.has(i))) lines++;
  }
  return lines;
}
function applyPlacement(game: GameState, pieceId: number, row: number, col: number) {
  const piece = game.tray.find((p) => p?.id === pieceId) ?? null;
  if (!piece || !canPlace(game.board, piece, row, col)) return game;
  const board = [...game.board];
  for (const [dx, dy] of piece.shape.cells) board[toIndex(row + dy, col + dx)] = { tone: piece.tone, groupId: piece.id };
  const clearedIndices = findClears(board);
  const previousCombo = game.combo;
  let combo = 0;
  const clearedTones: Record<number, string> = {};
  if (clearedIndices.size > 0) {
    for (const i of clearedIndices) { clearedTones[i] = piece.tone; board[i] = null; }
    combo = previousCombo + 1;
  }
  const linesCleared = countLines(clearedIndices);
  const comboMultiplier = Math.max(1, combo + 1);
  const score = game.score + piece.shape.cells.length * 10 + linesCleared * 120 * comboMultiplier;
  const bestScore = Math.max(score, game.bestScore);
  let tray = game.tray.map((e) => (e?.id === pieceId ? null : e));
  let nextPieceId = game.nextPieceId;
  let rngState = game.rngState;
  if (tray.every((e) => e === null)) {
    const next = buildTray(board, nextPieceId, game.rngState);
    tray = next.tray; nextPieceId = next.nextPieceId; rngState = next.rngState;
  }
  const gameOver = !tray.some((e) => e && hasAnyPlacement(board, e));
  return { ...game, board, tray, nextPieceId, rngState, score, bestScore, combo, selectedPieceId: null, preview: null, gameOver, cleared: [...clearedIndices], clearedTones };
}

function computeRunStats(seed: string, moves: Move[]) {
  let game = createGameState(seed);
  let bestCombo = 0;
  let bestMoveScore = 0;
  let bestLinesCleared = 0;

  for (const move of moves) {
    const pieceId = Number.parseInt(String(move?.pieceId ?? ""), 10);
    const row = Number.parseInt(String(move?.row ?? ""), 10);
    const col = Number.parseInt(String(move?.col ?? ""), 10);
    if (![pieceId, row, col].every(Number.isInteger)) return null;

    const piece = game.tray.find((p) => p?.id === pieceId);
    if (piece && canPlace(game.board, piece, row, col)) {
      const testBoard = [...game.board];
      for (const [dx, dy] of piece.shape.cells) testBoard[toIndex(row + dy, col + dx)] = { tone: piece.tone, groupId: piece.id };
      bestLinesCleared = Math.max(bestLinesCleared, countLines(findClears(testBoard)));
    }

    const scoreBefore = game.score;
    const next = applyPlacement(game, pieceId, row, col);
    if (next === game) return null;

    bestMoveScore = Math.max(bestMoveScore, next.score - scoreBefore);
    bestCombo = Math.max(bestCombo, next.combo);
    game = next;
  }

  if (!game.gameOver) return null;
  return { bestCombo, bestMoveScore, bestLinesCleared, moveCount: moves.length };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...(init?.headers ?? {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return json({ error: "Missing Supabase env vars." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: rows, error: fetchError } = await supabase
      .from("scores")
      .select("id, run_id, runs!inner(seed, moves)")
      .not("run_id", "is", null)
      .is("best_combo", null);

    if (fetchError) {
      return json({ error: fetchError.message }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return json({ message: "Nothing to backfill.", updated: 0, failed: 0 });
    }

    let updated = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const row of rows) {
      const run = row.runs as { seed: string; moves: Move[] };
      const stats = computeRunStats(run.seed, run.moves);

      if (!stats) {
        failures.push(`score ${row.id}: replay failed`);
        failed++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("scores")
        .update({
          best_combo: stats.bestCombo,
          best_move_score: stats.bestMoveScore,
          best_lines_cleared: stats.bestLinesCleared,
          move_count: stats.moveCount,
        })
        .eq("id", row.id);

      if (updateError) {
        failures.push(`score ${row.id}: ${updateError.message}`);
        failed++;
      } else {
        updated++;
      }
    }

    return json({ message: "Backfill complete.", updated, failed, failures });
  } catch (error) {
    return json({ error: String(error) }, { status: 500 });
  }
});
