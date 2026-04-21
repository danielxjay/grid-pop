export const GRID_SIZE = 8;
export const TRAY_SIZE = 3;
export const STORAGE_KEY = "gridpop-best-score";
export const RUN_HISTORY_STORAGE_KEY = "gridpop-run-history";
export const LEGACY_STORAGE_KEY = [
  98, 108, 111, 99, 107, 45, 98, 108, 97, 115, 116, 101, 114, 45, 98, 101,
  115, 116, 45, 115, 99, 111, 114, 101,
]
  .map((value) => String.fromCharCode(value))
  .join("");
export const MAX_LOCAL_RUNS = 50;
export const TONES = ["coral", "gold", "mint", "sky", "orchid"];
const DEFAULT_SEED = "gridpop-default-seed";

function hashSeed(seed) {
  const source = String(seed || DEFAULT_SEED);
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0 || 1;
}

function nextRandomValue(rngState) {
  let state = (rngState + 0x6d2b79f5) >>> 0;
  let value = Math.imul(state ^ (state >>> 15), state | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

  return {
    rngState: state,
    value: ((value ^ (value >>> 14)) >>> 0) / 4294967296,
  };
}

export function createGameSeed() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRunId(score) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${score}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRunEntry(entry) {
  const score = Number.parseInt(String(entry?.score ?? 0), 10);
  const createdAt = typeof entry?.createdAt === "string" ? entry.createdAt : "";

  if (!Number.isFinite(score) || score < 0 || !createdAt) {
    return null;
  }

  const bestCombo = Number.isFinite(Number(entry?.bestCombo)) ? Math.max(0, Number(entry.bestCombo)) : 0;
  const bestMoveScore = Number.isFinite(Number(entry?.bestMoveScore)) ? Math.max(0, Number(entry.bestMoveScore)) : 0;
  const bestLinesCleared = Number.isFinite(Number(entry?.bestLinesCleared)) ? Math.max(0, Number(entry.bestLinesCleared)) : 0;
  const moveCount = Number.isFinite(Number(entry?.moveCount)) ? Math.max(0, Number(entry.moveCount)) : 0;

  return {
    id:
      typeof entry?.id === "string" && entry.id
        ? entry.id
        : `${createdAt}-${score}`,
    score,
    createdAt,
    synced: Boolean(entry?.synced),
    bestCombo,
    bestMoveScore,
    bestLinesCleared,
    moveCount,
  };
}

function saveRunHistory(history) {
  try {
    localStorage.setItem(RUN_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

export const SHAPES = [
  { name: "single", cells: [[0, 0]] },
  { name: "bar-2", cells: [[0, 0], [1, 0]] },
  { name: "bar-3", cells: [[0, 0], [1, 0], [2, 0]] },
  { name: "bar-4", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: "bar-5", cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { name: "col-2", cells: [[0, 0], [0, 1]] },
  { name: "col-3", cells: [[0, 0], [0, 1], [0, 2]] },
  { name: "col-4", cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { name: "square-2", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  {
    name: "square-3",
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ],
  },
  { name: "l-3", cells: [[0, 0], [0, 1], [1, 1]] },
  { name: "l-4", cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: "j-4", cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
  { name: "t-4", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: "zig-4", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { name: "s-4", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: "step-5", cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
];

export function createBoard() {
  return Array.from({ length: GRID_SIZE * GRID_SIZE }, () => null);
}

export function loadBestScore() {
  try {
    const currentValue = localStorage.getItem(STORAGE_KEY);

    if (currentValue !== null) {
      return Number.parseInt(currentValue || "0", 10);
    }

    const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);

    if (legacyValue !== null) {
      localStorage.setItem(STORAGE_KEY, legacyValue);
      return Number.parseInt(legacyValue || "0", 10);
    }

    return 0;
  } catch {
    return 0;
  }
}

export function saveBestScore(score) {
  try {
    localStorage.setItem(STORAGE_KEY, String(score));
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

export function loadRunHistory() {
  try {
    const rawValue = localStorage.getItem(RUN_HISTORY_STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed
      .map(normalizeRunEntry)
      .filter(Boolean)
      .slice(0, MAX_LOCAL_RUNS);

    if (JSON.stringify(parsed.slice(0, normalized.length)) !== JSON.stringify(normalized)) {
      saveRunHistory(normalized);
    }

    return normalized;
  } catch {
    return [];
  }
}

export function recordRunScore(score, stats = {}) {
  const nextEntry = {
    id: createRunId(score),
    score: Number.parseInt(String(score ?? 0), 10),
    createdAt: new Date().toISOString(),
    synced: false,
    bestCombo: Number.isFinite(stats.bestCombo) ? Math.max(0, stats.bestCombo) : 0,
    bestMoveScore: Number.isFinite(stats.bestMoveScore) ? Math.max(0, stats.bestMoveScore) : 0,
    bestLinesCleared: Number.isFinite(stats.bestLinesCleared) ? Math.max(0, stats.bestLinesCleared) : 0,
    moveCount: Number.isFinite(stats.moveCount) ? Math.max(0, stats.moveCount) : 0,
  };

  if (!Number.isFinite(nextEntry.score) || nextEntry.score < 0) {
    return loadRunHistory();
  }

  try {
    const nextHistory = [nextEntry, ...loadRunHistory()].slice(0, MAX_LOCAL_RUNS);
    saveRunHistory(nextHistory);
    return nextHistory;
  } catch {
    return loadRunHistory();
  }
}

export function markRunsAsSynced(runIds) {
  if (!Array.isArray(runIds) || runIds.length === 0) {
    return loadRunHistory();
  }

  const targetIds = new Set(runIds);
  const nextHistory = loadRunHistory().map((entry) =>
    targetIds.has(entry.id) ? { ...entry, synced: true } : entry
  );

  saveRunHistory(nextHistory);
  return nextHistory;
}

export function createGameState(bestScore = loadBestScore(), options = {}) {
  const board = createBoard();
  const seed = typeof options.seed === "string" && options.seed ? options.seed : createGameSeed();
  const initialRngState = hashSeed(seed);
  const { tray, nextPieceId, rngState } = buildTray(board, 1, initialRngState);

  return {
    board,
    tray,
    nextPieceId,
    seed,
    rngState,
    score: 0,
    bestScore,
    combo: 0,
    bestCombo: 0,
    bestMoveScore: 0,
    bestLinesCleared: 0,
    moveCount: 0,
    selectedPieceId: null,
    preview: null,
    gameOver: false,
    cleared: [],
    clearedTones: {},
  };
}

export function togglePieceSelection(game, pieceId) {
  return {
    ...game,
    selectedPieceId: game.selectedPieceId === pieceId ? null : pieceId,
    preview: null,
  };
}

export function clearPreview(game) {
  if (game.preview === null) {
    return game;
  }

  return {
    ...game,
    preview: null,
  };
}

export function setPreview(game, preview) {
  if (matchesPreview(game.preview, preview)) {
    return game;
  }

  return {
    ...game,
    preview,
  };
}

export function clearClearedCells(game) {
  if (game.cleared.length === 0) {
    return game;
  }

  return {
    ...game,
    cleared: [],
    clearedTones: {},
  };
}

export function applyPlacement(game, pieceId, row, col) {
  const piece = findPiece(game.tray, pieceId);

  if (!piece || !canPlace(game.board, piece, row, col)) {
    return game;
  }

  const board = [...game.board];

  for (const [dx, dy] of piece.shape.cells) {
    const nextRow = row + dy;
    const nextCol = col + dx;
    board[toIndex(nextRow, nextCol)] = { tone: piece.tone, groupId: piece.id };
  }

  const clearedIndices = findClears(board);
  const blocksPlaced = piece.shape.cells.length;
  const previousCombo = game.combo;
  let combo = 0;
  let cleared = [];

  const clearedTones = {};
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
  const moveScore = blocksPlaced * 10 + lineScore * comboMultiplier;
  const score = game.score + moveScore;
  const bestScore = Math.max(score, game.bestScore);
  const bestCombo = Math.max(game.bestCombo, combo);
  const bestMoveScore = Math.max(game.bestMoveScore, moveScore);
  const bestLinesCleared = Math.max(game.bestLinesCleared, linesCleared);
  const moveCount = game.moveCount + 1;

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
    bestCombo,
    bestMoveScore,
    bestLinesCleared,
    moveCount,
    selectedPieceId: null,
    preview: null,
    gameOver,
    cleared,
    clearedTones,
  };
}

export function buildPreview(board, piece, row, col) {
  if (!piece) {
    return null;
  }

  return {
    pieceId: piece.id,
    row,
    col,
    valid: canPlace(board, piece, row, col),
  };
}

export function findPiece(tray, pieceId) {
  return tray.find((piece) => piece?.id === pieceId) || null;
}

export function canPlace(board, piece, row, col) {
  return piece.shape.cells.every(([dx, dy]) => {
    const nextRow = row + dy;
    const nextCol = col + dx;

    if (
      nextRow < 0 ||
      nextRow >= GRID_SIZE ||
      nextCol < 0 ||
      nextCol >= GRID_SIZE
    ) {
      return false;
    }

    return board[toIndex(nextRow, nextCol)] === null;
  });
}

export function getShapeBounds(shape) {
  const width = Math.max(...shape.cells.map(([dx]) => dx)) + 1;
  const height = Math.max(...shape.cells.map(([, dy]) => dy)) + 1;
  return { width, height };
}

export function toIndex(row, col) {
  return row * GRID_SIZE + col;
}

function buildTray(board, nextPieceId, rngState) {
  let tray = [];
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

function createRandomPiece(nextPieceId, rngState) {
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

function hasPotentialMove(board) {
  return SHAPES.some((shape) =>
    hasAnyPlacement(board, {
      id: -1,
      shape,
      tone: TONES[0],
      bounds: getShapeBounds(shape),
    })
  );
}

function hasAnyPlacement(board, piece) {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      if (canPlace(board, piece, row, col)) {
        return true;
      }
    }
  }

  return false;
}

export function findClears(board) {
  const cleared = new Set();

  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowIndices = Array.from({ length: GRID_SIZE }, (_, col) =>
      toIndex(row, col)
    );

    if (rowIndices.every((index) => board[index] !== null)) {
      rowIndices.forEach((index) => cleared.add(index));
    }
  }

  for (let col = 0; col < GRID_SIZE; col += 1) {
    const colIndices = Array.from({ length: GRID_SIZE }, (_, row) =>
      toIndex(row, col)
    );

    if (colIndices.every((index) => board[index] !== null)) {
      colIndices.forEach((index) => cleared.add(index));
    }
  }

  return cleared;
}

function countLines(clearedIndices) {
  let lines = 0;

  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowIndices = Array.from({ length: GRID_SIZE }, (_, col) =>
      toIndex(row, col)
    );

    if (rowIndices.every((index) => clearedIndices.has(index))) {
      lines += 1;
    }
  }

  for (let col = 0; col < GRID_SIZE; col += 1) {
    const colIndices = Array.from({ length: GRID_SIZE }, (_, row) =>
      toIndex(row, col)
    );

    if (colIndices.every((index) => clearedIndices.has(index))) {
      lines += 1;
    }
  }

  return lines;
}

function matchesPreview(previousPreview, nextPreview) {
  if (previousPreview === nextPreview) {
    return true;
  }

  if (previousPreview === null || nextPreview === null) {
    return false;
  }

  return (
    previousPreview.pieceId === nextPreview.pieceId &&
    previousPreview.row === nextPreview.row &&
    previousPreview.col === nextPreview.col &&
    previousPreview.valid === nextPreview.valid
  );
}

export function replayRun(seed, moves) {
  if (!Array.isArray(moves)) {
    return {
      valid: false,
      error: "Moves payload must be an array.",
    };
  }

  let game = createGameState(0, { seed });

  for (const move of moves) {
    const pieceId = Number.parseInt(String(move?.pieceId ?? ""), 10);
    const row = Number.parseInt(String(move?.row ?? ""), 10);
    const col = Number.parseInt(String(move?.col ?? ""), 10);

    if (![pieceId, row, col].every(Number.isInteger)) {
      return {
        valid: false,
        error: "Move payload is malformed.",
      };
    }

    const nextGame = applyPlacement(game, pieceId, row, col);

    if (nextGame === game) {
      return {
        valid: false,
        error: "Run contains an invalid placement.",
      };
    }

    game = nextGame;
  }

  if (!game.gameOver) {
    return {
      valid: false,
      error: "Run is not complete.",
    };
  }

  return {
    valid: true,
    score: game.score,
    game,
  };
}
