import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
const MAX_MOVES = 512;
const RETAINED_MOVE_LOG_RUNS = 5;

type Move = {
  pieceId: number;
  row: number;
  col: number;
};

type BoardCell = {
  tone: string;
  groupId: number;
} | null;

type Piece = {
  id: number;
  shape: (typeof SHAPES)[number];
  tone: string;
  bounds: {
    width: number;
    height: number;
  };
};

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

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init?.headers ?? {}),
    },
  });
}

function hashSeed(seed: string) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0 || 1;
}

function nextRandomValue(rngState: number) {
  const state = (rngState + 0x6d2b79f5) >>> 0;
  let value = Math.imul(state ^ (state >>> 15), state | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

  return {
    rngState: state,
    value: ((value ^ (value >>> 14)) >>> 0) / 4294967296,
  };
}

function createBoard() {
  return Array.from({ length: GRID_SIZE * GRID_SIZE }, () => null as BoardCell);
}

function getShapeBounds(shape: (typeof SHAPES)[number]) {
  const width = Math.max(...shape.cells.map(([dx]) => dx)) + 1;
  const height = Math.max(...shape.cells.map(([, dy]) => dy)) + 1;
  return { width, height };
}

function toIndex(row: number, col: number) {
  return row * GRID_SIZE + col;
}

function canPlace(board: BoardCell[], piece: Piece, row: number, col: number) {
  return piece.shape.cells.every(([dx, dy]) => {
    const nextRow = row + dy;
    const nextCol = col + dx;

    if (nextRow < 0 || nextRow >= GRID_SIZE || nextCol < 0 || nextCol >= GRID_SIZE) {
      return false;
    }

    return board[toIndex(nextRow, nextCol)] === null;
  });
}

function hasAnyPlacement(board: BoardCell[], piece: Piece) {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      if (canPlace(board, piece, row, col)) {
        return true;
      }
    }
  }

  return false;
}

function hasPotentialMove(board: BoardCell[]) {
  return SHAPES.some((shape) =>
    hasAnyPlacement(board, {
      id: -1,
      shape,
      tone: TONES[0],
      bounds: getShapeBounds(shape),
    })
  );
}

function createRandomPiece(nextPieceId: number, rngState: number) {
  const shapePick = nextRandomValue(rngState);
  const tonePick = nextRandomValue(shapePick.rngState);
  const shape = SHAPES[Math.floor(shapePick.value * SHAPES.length) % SHAPES.length];
  const tone = TONES[Math.floor(tonePick.value * TONES.length) % TONES.length];

  return {
    piece: {
      id: nextPieceId,
      shape,
      tone,
      bounds: getShapeBounds(shape),
    },
    nextPieceId: nextPieceId + 1,
    rngState: tonePick.rngState,
  };
}

function buildTray(board: BoardCell[], nextPieceId: number, rngState: number) {
  let tray: Piece[] = [];
  let currentPieceId = nextPieceId;
  let currentRngState = rngState;

  for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
    const pieceState = createRandomPiece(currentPieceId, currentRngState);
    tray.push(pieceState.piece);
    currentPieceId = pieceState.nextPieceId;
    currentRngState = pieceState.rngState;
  }

  if (hasPotentialMove(board)) {
    let attempts = 0;

    while (attempts < 40 && !tray.some((piece) => hasAnyPlacement(board, piece))) {
      tray = [];
      currentPieceId = nextPieceId;

      for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
        const pieceState = createRandomPiece(currentPieceId, currentRngState);
        tray.push(pieceState.piece);
        currentPieceId = pieceState.nextPieceId;
        currentRngState = pieceState.rngState;
      }

      attempts += 1;
    }
  }

  return {
    tray,
    nextPieceId: currentPieceId,
    rngState: currentRngState,
  };
}

function createGameState(seed: string): GameState {
  const board = createBoard();
  const initialRngState = hashSeed(seed);
  const { tray, nextPieceId, rngState } = buildTray(board, 1, initialRngState);

  return {
    board,
    tray,
    nextPieceId,
    rngState,
    score: 0,
    bestScore: 0,
    combo: 0,
    selectedPieceId: null,
    preview: null,
    gameOver: false,
    cleared: [],
    clearedTones: {},
  };
}

function findPiece(tray: Array<Piece | null>, pieceId: number) {
  return tray.find((piece) => piece?.id === pieceId) ?? null;
}

function findClears(board: BoardCell[]) {
  const cleared = new Set<number>();

  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowIndices = Array.from({ length: GRID_SIZE }, (_, col) => toIndex(row, col));

    if (rowIndices.every((index) => board[index] !== null)) {
      rowIndices.forEach((index) => cleared.add(index));
    }
  }

  for (let col = 0; col < GRID_SIZE; col += 1) {
    const colIndices = Array.from({ length: GRID_SIZE }, (_, row) => toIndex(row, col));

    if (colIndices.every((index) => board[index] !== null)) {
      colIndices.forEach((index) => cleared.add(index));
    }
  }

  return cleared;
}

function countLines(clearedIndices: Set<number>) {
  let lines = 0;

  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowIndices = Array.from({ length: GRID_SIZE }, (_, col) => toIndex(row, col));

    if (rowIndices.every((index) => clearedIndices.has(index))) {
      lines += 1;
    }
  }

  for (let col = 0; col < GRID_SIZE; col += 1) {
    const colIndices = Array.from({ length: GRID_SIZE }, (_, row) => toIndex(row, col));

    if (colIndices.every((index) => clearedIndices.has(index))) {
      lines += 1;
    }
  }

  return lines;
}

function applyPlacement(game: GameState, pieceId: number, row: number, col: number) {
  const piece = findPiece(game.tray, pieceId);

  if (!piece || !canPlace(game.board, piece, row, col)) {
    return game;
  }

  const board = [...game.board];

  for (const [dx, dy] of piece.shape.cells) {
    board[toIndex(row + dy, col + dx)] = { tone: piece.tone, groupId: piece.id };
  }

  const clearedIndices = findClears(board);
  const blocksPlaced = piece.shape.cells.length;
  const previousCombo = game.combo;
  let combo = 0;
  let cleared: number[] = [];
  const clearedTones: Record<number, string> = {};

  if (clearedIndices.size > 0) {
    for (const index of clearedIndices) {
      clearedTones[index] = piece.tone;
      board[index] = null;
    }

    combo = previousCombo + 1;
    cleared = [...clearedIndices];
  }

  const linesCleared = countLines(clearedIndices);
  const comboMultiplier = Math.max(1, combo + 1);
  const lineScore = (linesCleared * (linesCleared + 1) / 2) * 120;
  const score = game.score + blocksPlaced * 10 + lineScore * comboMultiplier;
  const bestScore = Math.max(score, game.bestScore);
  let tray = game.tray.map((entry) => (entry?.id === pieceId ? null : entry));
  let nextPieceId = game.nextPieceId;
  let rngState = game.rngState;

  if (tray.every((entry) => entry === null)) {
    const nextTrayState = buildTray(board, nextPieceId, game.rngState);
    tray = nextTrayState.tray;
    nextPieceId = nextTrayState.nextPieceId;
    rngState = nextTrayState.rngState;
  }

  const gameOver = !tray.some((entry) => entry && hasAnyPlacement(board, entry));

  return {
    ...game,
    board,
    tray,
    nextPieceId,
    rngState,
    score,
    bestScore,
    combo,
    selectedPieceId: null,
    preview: null,
    gameOver,
    cleared,
    clearedTones,
  };
}

function replayRun(seed: string, moves: Move[]) {
  let game = createGameState(seed);
  let bestCombo = 0;
  let bestMoveScore = 0;
  let bestLinesCleared = 0;

  for (const move of moves) {
    const pieceId = Number.parseInt(String(move?.pieceId ?? ""), 10);
    const row = Number.parseInt(String(move?.row ?? ""), 10);
    const col = Number.parseInt(String(move?.col ?? ""), 10);

    if (![pieceId, row, col].every(Number.isInteger)) {
      return { valid: false, error: "Move payload is malformed." };
    }

    const piece = findPiece(game.tray, pieceId);
    if (piece && canPlace(game.board, piece, row, col)) {
      const testBoard = [...game.board];
      for (const [dx, dy] of piece.shape.cells) testBoard[toIndex(row + dy, col + dx)] = { tone: piece.tone, groupId: piece.id };
      bestLinesCleared = Math.max(bestLinesCleared, countLines(findClears(testBoard)));
    }

    const scoreBefore = game.score;
    const nextGame = applyPlacement(game, pieceId, row, col);

    if (nextGame === game) {
      return { valid: false, error: "Run contains an invalid placement." };
    }

    bestMoveScore = Math.max(bestMoveScore, nextGame.score - scoreBefore);
    bestCombo = Math.max(bestCombo, nextGame.combo);
    game = nextGame;
  }

  if (!game.gameOver) {
    return { valid: false, error: "Run is not complete." };
  }

  return { valid: true, score: game.score, bestCombo, bestMoveScore, bestLinesCleared, moveCount: moves.length };
}

async function pruneOldMoveLogs(supabaseAdmin: ReturnType<typeof createClient>, userId: string) {
  const { data: runs, error: runsError } = await supabaseAdmin
    .from("runs")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["verified", "rejected"])
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .order("started_at", { ascending: false });

  if (runsError) {
    console.error("Move log retention lookup failed.", runsError);
    return;
  }

  const staleRunIds = (runs ?? []).slice(RETAINED_MOVE_LOG_RUNS).map((run) => run.id);

  if (staleRunIds.length === 0) {
    return;
  }

  const { error: pruneError } = await supabaseAdmin
    .from("runs")
    .update({ moves: [] })
    .in("id", staleRunIds);

  if (pruneError) {
    console.error("Move log pruning failed.", pruneError);
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing Supabase function env vars.");
      return json({ error: "Supabase function secrets are missing." }, { status: 500 });
    }

    if (!authHeader) {
      return json({ error: "Missing authorization header." }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      console.error("Auth lookup failed.", authError);
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const runId = typeof body?.runId === "string" ? body.runId : "";
    const moves = Array.isArray(body?.moves) ? body.moves.slice(0, MAX_MOVES) : null;

    if (!runId || !moves) {
      return json({ error: "A run id and moves array are required." }, { status: 400 });
    }

    const { data: run, error: claimError } = await supabaseAdmin
      .from("runs")
      .update({
        status: "submitted",
        moves,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .select("id, seed")
      .maybeSingle();

    if (claimError) {
      console.error("Run claim failed.", claimError);
      return json({ error: "Could not claim this run." }, { status: 500 });
    }

    if (!run) {
      return json({ error: "This run is no longer active." }, { status: 409 });
    }

    const verification = replayRun(run.seed, moves as Move[]);

    if (!verification.valid) {
      await supabaseAdmin
        .from("runs")
        .update({
          status: "rejected",
          rejection_reason: verification.error ?? "Verification failed.",
        })
        .eq("id", run.id);

      await pruneOldMoveLogs(supabaseAdmin, authData.user.id);

      return json({ error: verification.error ?? "Verification failed." }, { status: 400 });
    }

    const score = verification.score ?? 0;

    const { error: runUpdateError } = await supabaseAdmin
      .from("runs")
      .update({
        status: "verified",
        verified_score: score,
        rejection_reason: null,
      })
      .eq("id", run.id);

    if (runUpdateError) {
      console.error("Run verification update failed.", runUpdateError);
      return json({ error: "Could not finalize this run." }, { status: 500 });
    }

    const { error: scoreError } = await supabaseAdmin.from("scores").insert({
      user_id: authData.user.id,
      run_id: run.id,
      score,
      best_combo: verification.bestCombo,
      best_move_score: verification.bestMoveScore,
      best_lines_cleared: verification.bestLinesCleared,
      move_count: verification.moveCount,
    });

    if (scoreError) {
      console.error("Verified score insert failed.", scoreError);
      return json({ error: "Could not record the verified score." }, { status: 500 });
    }

    await pruneOldMoveLogs(supabaseAdmin, authData.user.id);

    return json({ score });
  } catch (error) {
    console.error("Unexpected finish-run failure.", error);
    return json({ error: "Unexpected finish-run failure." }, { status: 500 });
  }
});
