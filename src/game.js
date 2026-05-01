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

export const CRUNCH_SHAPES = SHAPES.filter(({ name }) =>
  ['single', 'bar-2', 'bar-3', 'col-2', 'col-3', 'l-3', 'square-2'].includes(name)
);

const GRID_ROW_INDICES = Array.from({ length: GRID_SIZE }, (_, row) =>
  Array.from({ length: GRID_SIZE }, (_, col) => toIndex(row, col))
);
const GRID_COL_INDICES = Array.from({ length: GRID_SIZE }, (_, col) =>
  Array.from({ length: GRID_SIZE }, (_, row) => toIndex(row, col))
);
const SHAPE_BOUNDS = new Map();
const SHAPE_PLACEMENT_PROBES = new Map();

const SHAPE_BASE_WEIGHTS = {
  single: 1.15,
  "bar-2": 1.05,
  "col-2": 1.0,
  "bar-3": 1.03,
  "col-3": 1.0,
  "square-2": 1.0,
  "l-3": 0.97,
  "bar-4": 0.96,
  "col-4": 0.93,
  "t-4": 0.94,
  "j-4": 0.9,
  "l-4": 0.9,
  "zig-4": 0.9,
  "s-4": 0.9,
  "bar-5": 0.85,
  "step-5": 0.82,
  "square-3": 0.7,
};

const SHAPE_FAMILIES = {
  single: "single",
  "bar-2": "line",
  "bar-3": "line",
  "bar-4": "line",
  "bar-5": "line",
  "col-2": "line",
  "col-3": "line",
  "col-4": "line",
  "square-2": "square",
  "square-3": "square",
  "l-3": "hook",
  "l-4": "hook",
  "j-4": "hook",
  "t-4": "tee",
  "zig-4": "zig",
  "s-4": "zig",
  "step-5": "step",
};

function normalizeIncomingPiece(piece) {
  if (!piece) {
    return null;
  }

  const shapeName = typeof piece.shape?.name === "string" ? piece.shape.name : "";
  const shape = SHAPES.find((entry) => entry.name === shapeName) ?? piece.shape;
  return {
    id: Number.parseInt(String(piece.id ?? -1), 10),
    shape,
    tone: typeof piece.tone === "string" ? piece.tone : TONES[0],
    bounds: piece.bounds ?? getShapeBounds(shape),
  };
}

function getPlacementProbe(shape) {
  let probe = SHAPE_PLACEMENT_PROBES.get(shape);
  if (!probe) {
    probe = {
      id: -1,
      shape,
      tone: TONES[0],
      bounds: getShapeBounds(shape),
    };
    SHAPE_PLACEMENT_PROBES.set(shape, probe);
  }
  return probe;
}

function normalizeIncomingTray(tray) {
  return Array.from({ length: TRAY_SIZE }, (_, index) => normalizeIncomingPiece(tray?.[index] ?? null));
}

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

const CRUNCH_BEST_KEY = "gridpop-crunch-best";

export function loadCrunchBestRating() {
  try {
    const v = localStorage.getItem(CRUNCH_BEST_KEY);
    return v !== null ? Number.parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

export function saveCrunchBestRating(rating) {
  try {
    localStorage.setItem(CRUNCH_BEST_KEY, String(rating));
  } catch {}
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
  const ranked = Boolean(options.ranked);
  const crunch = Boolean(options.crunch);
  const shapes = crunch ? CRUNCH_SHAPES : SHAPES;
  const hasServerTray = Array.isArray(options.tray);
  const seed = hasServerTray
    ? null
    : typeof options.seed === "string" && options.seed
      ? options.seed
      : createGameSeed();
  const initialRngState = hasServerTray ? 0 : hashSeed(seed);
  const serverTray = hasServerTray ? normalizeIncomingTray(options.tray) : null;
  const { tray, nextPieceId, rngState } = hasServerTray
    ? {
        tray: serverTray,
        nextPieceId: (serverTray.reduce((max, piece) => Math.max(max, piece?.id ?? 0), 0) || 0) + 1,
        rngState: 0,
      }
    : buildTray(board, 1, initialRngState, shapes);

  return {
    board,
    tray,
    nextPieceId,
    seed,
    rngState,
    ranked,
    crunch,
    awaitingTray: false,
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

  const newlyClearedIndices = findNewlyClearedIndices(game.board, board);
  const blocksPlaced = piece.shape.cells.length;
  const previousCombo = game.combo;
  let combo = 0;
  let cleared = [];

  const clearedTones = {};
  if (newlyClearedIndices.size > 0) {
    for (const index of newlyClearedIndices) {
      clearedTones[index] = piece.tone;
      board[index] = null;
    }

    combo = previousCombo + 1;
    cleared = [...newlyClearedIndices];
  }

  const linesCleared = countLines(newlyClearedIndices, board);
  const comboMultiplier = Math.max(1, combo + 1);
  const burstScore = linesCleared * linesCleared * 180;
  const moveScore = blocksPlaced * 15 + burstScore * comboMultiplier;
  const score = game.score + moveScore;
  const bestScore = Math.max(score, game.bestScore);
  const bestCombo = Math.max(game.bestCombo, combo);
  const bestMoveScore = Math.max(game.bestMoveScore, moveScore);
  const bestLinesCleared = Math.max(game.bestLinesCleared, linesCleared);
  const moveCount = game.moveCount + 1;

  let tray = game.tray.map((entry) => (entry?.id === pieceId ? null : entry));
  let nextPieceId = game.nextPieceId;
  let rngState = game.rngState;
  const trayExhausted = tray.every((entry) => entry === null);

  if (trayExhausted && !game.ranked) {
    const nextTrayState = buildTray(board, nextPieceId, game.rngState, game.crunch ? CRUNCH_SHAPES : SHAPES);
    tray = nextTrayState.tray;
    nextPieceId = nextTrayState.nextPieceId;
    rngState = nextTrayState.rngState;
  }

  if (trayExhausted && game.ranked) {
    return {
      ...game,
      board,
      tray,
      nextPieceId,
      rngState,
      ranked: true,
      awaitingTray: true,
      score,
      bestScore,
      combo,
      bestCombo,
      bestMoveScore,
      bestLinesCleared,
      moveCount,
      selectedPieceId: null,
      preview: null,
      gameOver: false,
      cleared,
      clearedTones,
    };
  }

  const gameOver = game.crunch ? false : !tray.some((entry) => entry && hasAnyPlacement(board, entry));

  return {
    ...game,
    board,
    tray,
    nextPieceId,
    rngState,
    ranked: Boolean(game.ranked),
    awaitingTray: false,
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

export function setRankedTray(game, tray) {
  const nextTray = normalizeIncomingTray(tray);
  const nextPieceId = Math.max(game.nextPieceId, nextTray.reduce((max, piece) => Math.max(max, piece?.id ?? 0), 0) + 1);
  const gameOver = !nextTray.some((piece) => piece && hasAnyPlacement(game.board, piece));

  return {
    ...game,
    tray: nextTray,
    nextPieceId,
    ranked: true,
    awaitingTray: false,
    selectedPieceId: null,
    preview: null,
    gameOver,
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
  const bounds = getShapeBounds(piece.shape);
  if (
    row < 0 ||
    col < 0 ||
    row + bounds.height > GRID_SIZE ||
    col + bounds.width > GRID_SIZE
  ) {
    return false;
  }

  for (const [dx, dy] of piece.shape.cells) {
    const nextRow = row + dy;
    const nextCol = col + dx;

    if (board[toIndex(nextRow, nextCol)] !== null) {
      return false;
    }
  }

  return true;
}

export function getShapeBounds(shape) {
  let bounds = SHAPE_BOUNDS.get(shape);
  if (!bounds) {
    let maxX = 0;
    let maxY = 0;
    for (const [dx, dy] of shape.cells) {
      if (dx > maxX) maxX = dx;
      if (dy > maxY) maxY = dy;
    }
    bounds = { width: maxX + 1, height: maxY + 1 };
    SHAPE_BOUNDS.set(shape, bounds);
  }
  return bounds;
}

export function toIndex(row, col) {
  return row * GRID_SIZE + col;
}

const SLOT_PLACEABLE_THRESHOLDS = [1.0, 0.8, 0.5];

function buildTray(board, nextPieceId, rngState, shapes = SHAPES) {
  let tray = [];
  let trayShapes = [];
  let currentPieceId = nextPieceId;
  let currentRngState = rngState;

  const thresholds = [...SLOT_PLACEABLE_THRESHOLDS];

  for (let i = thresholds.length - 1; i > 0; i -= 1) {
    const roll = nextRandomValue(currentRngState);
    currentRngState = roll.rngState;
    const j = Math.floor(roll.value * (i + 1));
    [thresholds[i], thresholds[j]] = [thresholds[j], thresholds[i]];
  }

  for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
    const threshold = thresholds[slot] ?? 0.5;
    let requirePlaceable = true;

    if (threshold < 1.0) {
      const roll = nextRandomValue(currentRngState);
      requirePlaceable = roll.value < threshold;
      currentRngState = roll.rngState;
    }

    const pieceState = createRandomPiece(board, trayShapes, currentPieceId, currentRngState, requirePlaceable, shapes);
    tray.push(pieceState.piece);
    trayShapes.push(pieceState.piece.shape);
    currentPieceId = pieceState.nextPieceId;
    currentRngState = pieceState.rngState;
  }

  const requiredPlayableCount = getRequiredPlayableTrayCount(board, shapes);

  if (requiredPlayableCount > 0) {
    let attempts = 0;

    while (attempts < 40 && countPlayableTrayShapes(board, tray) < requiredPlayableCount) {
      tray = [];
      trayShapes = [];
      currentPieceId = nextPieceId;

      for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
        const pieceState = createRandomPiece(board, trayShapes, currentPieceId, currentRngState, true, shapes);
        tray.push(pieceState.piece);
        trayShapes.push(pieceState.piece.shape);
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

function countPlacements(board, shape) {
  const probe = getPlacementProbe(shape);
  const bounds = getShapeBounds(shape);
  let count = 0;

  for (let row = 0; row <= GRID_SIZE - bounds.height; row += 1) {
    for (let col = 0; col <= GRID_SIZE - bounds.width; col += 1) {
      if (canPlace(board, probe, row, col)) {
        count += 1;
      }
    }
  }

  return count;
}

function getShapeFamily(shape) {
  return SHAPE_FAMILIES[shape.name] || shape.name;
}

function getShapeWeight(board, shape, trayShapes, requirePlaceable, fillRatio) {
  const placements = countPlacements(board, shape);

  if (requirePlaceable && placements === 0) {
    return 0;
  }

  let weight = SHAPE_BASE_WEIGHTS[shape.name] ?? 1;

  if (requirePlaceable) {
    if (placements <= 2) {
      weight *= fillRatio >= 0.7 ? 0.62 : fillRatio >= 0.5 ? 0.8 : 0.9;
    } else if (placements <= 4) {
      weight *= fillRatio >= 0.7 ? 0.82 : fillRatio >= 0.5 ? 0.92 : 0.97;
    }

    if (fillRatio >= 0.7) {
      if (shape.cells.length <= 2) weight *= 1.1;
      if (shape.cells.length >= 5) weight *= 0.9;
      if (shape.name === "square-3") weight *= 0.82;
    } else if (fillRatio >= 0.5) {
      if (shape.cells.length <= 2) weight *= 1.03;
      if (shape.cells.length >= 5) weight *= 0.96;
      if (shape.name === "square-3") weight *= 0.9;
    } else if (fillRatio <= 0.25 && shape.cells.length >= 5) {
      weight *= 1.04;
    }
  }

  const family = getShapeFamily(shape);
  const repeatedFamilyCount = trayShapes.filter((entry) => getShapeFamily(entry) === family).length;

  if (repeatedFamilyCount === 1) {
    weight *= 0.8;
  } else if (repeatedFamilyCount >= 2) {
    weight *= 0.6;
  }

  return weight;
}

function pickWeightedShape(board, rngState, trayShapes, requirePlaceable, shapes = SHAPES) {
  const fillRatio = requirePlaceable
    ? board.reduce((count, cell) => count + (cell ? 1 : 0), 0) / board.length
    : 0;
  const weights = shapes.map((shape) => getShapeWeight(board, shape, trayShapes, requirePlaceable, fillRatio));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shapePick = nextRandomValue(rngState);

  if (totalWeight <= 0) {
    return {
      shape: shapes[Math.floor(shapePick.value * shapes.length) % shapes.length],
      rngState: shapePick.rngState,
    };
  }

  let remaining = shapePick.value * totalWeight;

  for (let index = 0; index < shapes.length; index += 1) {
    remaining -= weights[index];
    if (remaining <= 0) {
      return {
        shape: shapes[index],
        rngState: shapePick.rngState,
      };
    }
  }

  return {
    shape: shapes[shapes.length - 1],
    rngState: shapePick.rngState,
  };
}

function createRandomPiece(board, trayShapes, nextPieceId, rngState, requirePlaceable, shapes = SHAPES) {
  const shapePick = pickWeightedShape(board, rngState, trayShapes, requirePlaceable, shapes);
  const tonePick = nextRandomValue(shapePick.rngState);
  const tone = TONES[Math.floor(tonePick.value * TONES.length) % TONES.length];

  return {
    piece: {
      id: nextPieceId,
      shape: shapePick.shape,
      tone,
      bounds: getShapeBounds(shapePick.shape),
    },
    nextPieceId: nextPieceId + 1,
    rngState: tonePick.rngState,
  };
}

function hasPotentialMove(board, shapes = SHAPES) {
  return shapes.some((shape) => hasAnyPlacement(board, getPlacementProbe(shape)));
}

function countPlaceableShapes(board, shapes = SHAPES) {
  let count = 0;

  for (const shape of shapes) {
    if (hasAnyPlacement(board, getPlacementProbe(shape))) {
      count += 1;
    }
  }

  return count;
}

function countPlayableTrayShapes(board, tray) {
  const playableShapeNames = new Set();

  for (const piece of tray) {
    if (piece && hasAnyPlacement(board, piece)) {
      playableShapeNames.add(piece.shape.name);
    }
  }

  return playableShapeNames.size;
}

function getRequiredPlayableTrayCount(board, shapes = SHAPES) {
  const placeableShapeCount = countPlaceableShapes(board, shapes);

  if (placeableShapeCount <= 0) {
    return 0;
  }

  if (shapes === CRUNCH_SHAPES) {
    return Math.min(2, placeableShapeCount);
  }

  return 1;
}

function hasAnyPlacement(board, piece) {
  const bounds = getShapeBounds(piece.shape);
  for (let row = 0; row <= GRID_SIZE - bounds.height; row += 1) {
    for (let col = 0; col <= GRID_SIZE - bounds.width; col += 1) {
      if (canPlace(board, piece, row, col)) {
        return true;
      }
    }
  }

  return false;
}

// Wall cells are permanent — they block placement but never participate in line clears.
export function isCrunchWall(cell) {
  return cell !== null && typeof cell.groupId === 'string' && cell.groupId.startsWith('crunch-wall');
}

export function getCrunchTouchingWallCells(board) {
  const touching = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    let leftFront = -1;
    let rightFront = GRID_SIZE;

    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = board[toIndex(row, col)];
      if (cell !== null && cell.groupId === 'crunch-wall-l') {
        leftFront = Math.max(leftFront, col);
      } else if (cell !== null && cell.groupId === 'crunch-wall-r') {
        rightFront = Math.min(rightFront, col);
      }
    }

    if (leftFront !== -1 && rightFront !== GRID_SIZE && leftFront + 1 >= rightFront) {
      touching.push(toIndex(row, leftFront), toIndex(row, rightFront));
    }
  }

  return touching;
}

export function haveCrunchWallsJoined(board) {
  return getCrunchTouchingWallCells(board).length > 0;
}

function getCompletedLineSets(board) {
  const rows = new Set();
  const cols = new Set();

  for (let row = 0; row < GRID_ROW_INDICES.length; row += 1) {
    const rowIndices = GRID_ROW_INDICES[row];
    if (
      rowIndices.every((i) => board[i] !== null) &&
      rowIndices.some((i) => !isCrunchWall(board[i]))
    ) {
      rows.add(row);
    }
  }

  for (let col = 0; col < GRID_COL_INDICES.length; col += 1) {
    const colIndices = GRID_COL_INDICES[col];
    if (
      colIndices.every((i) => board[i] !== null) &&
      colIndices.some((i) => !isCrunchWall(board[i]))
    ) {
      cols.add(col);
    }
  }

  return { rows, cols };
}

function addCompletedLineCells(target, lineSets) {
  for (const row of lineSets.rows) {
    GRID_ROW_INDICES[row].forEach((i) => target.add(i));
  }

  for (const col of lineSets.cols) {
    GRID_COL_INDICES[col].forEach((i) => target.add(i));
  }
}

export function findClears(board) {
  const cleared = new Set();
  addCompletedLineCells(cleared, getCompletedLineSets(board));
  return cleared;
}

export function findNewlyClearedIndices(previousBoard, nextBoard) {
  const previousLines = getCompletedLineSets(previousBoard);
  const nextLines = getCompletedLineSets(nextBoard);
  const cleared = new Set();

  for (const row of nextLines.rows) {
    if (!previousLines.rows.has(row)) {
      GRID_ROW_INDICES[row].forEach((i) => cleared.add(i));
    }
  }

  for (const col of nextLines.cols) {
    if (!previousLines.cols.has(col)) {
      GRID_COL_INDICES[col].forEach((i) => cleared.add(i));
    }
  }

  return cleared;
}

function findCrunchWaveAutoClears(board) {
  const cleared = new Set();

  for (const rowIndices of GRID_ROW_INDICES) {
    if (
      rowIndices.every((i) => board[i] !== null) &&
      rowIndices.some((i) => !isCrunchWall(board[i]))
    ) {
      rowIndices.forEach((i) => cleared.add(i));
    }
  }

  return cleared;
}

function countLines(clearedIndices, board) {
  let lines = 0;

  for (const rowIndices of GRID_ROW_INDICES) {
    if (
      rowIndices.every((i) => clearedIndices.has(i)) &&
      rowIndices.some((i) => !isCrunchWall(board[i]))
    ) {
      lines += 1;
    }
  }

  for (const colIndices of GRID_COL_INDICES) {
    if (
      colIndices.every((i) => clearedIndices.has(i)) &&
      colIndices.some((i) => !isCrunchWall(board[i]))
    ) {
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

// Advances the crunch walls inward by one step on each side.
// Each wall's entire adjacent chain of poxels slides as a unit.
// Poxels with a gap between them and the wall are NOT shifted.
// When the chain front meets an obstacle: front + obstacle both pop, rest of chain slides.
// Left side processed first; right side reads the updated board so cross-half collisions resolve.
// After the wave, findClears runs to auto-pop any complete rows formed by walls + poxels.
// Game over fires the instant opposing walls become adjacent (no gap between them).
// Returns { game: nextGame, crushedCount: number }
export function applyCrunchWave(game, tone, { advanceLeft = true, advanceRight = true } = {}) {
  const old = game.board;
  // Strip pushDir from shifted poxels and isFill from existing wall cells so only the
  // freshly-placed slab this wave carries is-game-fill (and therefore the slide animation).
  // Old wall cells lose is-game-fill, freeing the cell element to show the pulse outline.
  const board = old.map((cell) => {
    if (cell === null) return null;
    const stripPush = cell.pushDir != null;
    const stripFill = cell.isFill && isCrunchWall(cell);
    if (!stripPush && !stripFill) return cell;
    return { ...cell, pushDir: undefined, isFill: stripFill ? false : cell.isFill };
  });
  let crushedCount = 0;
  const clearedWave = [];
  const clearedWaveTones = {};

  for (let row = 0; row < GRID_SIZE; row++) {
    // Compute both fronts for this row first (rows can differ if a row-clear removed some wall cells).
    let leftFront = -1;
    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = old[toIndex(row, col)];
      if (cell !== null && cell.groupId === 'crunch-wall-l') leftFront = col;
      else break;
    }
    let rightFront = GRID_SIZE;
    for (let col = GRID_SIZE - 1; col >= 0; col--) {
      const cell = old[toIndex(row, col)];
      if (cell !== null && cell.groupId === 'crunch-wall-r') rightFront = col;
      else break;
    }

    const leftNewCol = leftFront + 1;
    const rightNewCol = rightFront - 1;

    // === LEFT WALL — advance one step inward unless it would cross the right wall's target ===
    let skipLeftWall = false;
    if (advanceLeft && leftNewCol <= rightNewCol) {
      // Gather consecutive poxels immediately in front of the left wall (stop at gap or any wall).
      const chain = [];
      for (let col = leftNewCol; col < GRID_SIZE; col++) {
        const cell = old[toIndex(row, col)];
        if (cell !== null && !isCrunchWall(cell)) chain.push({ col, cell });
        else break;
      }

      if (chain.length > 0) {
        const frontCol = chain[chain.length - 1].col;
        const destCol = frontCol + 1;
        const atDest = board[toIndex(row, destCol)];

        if (atDest !== null) {
          if (isCrunchWall(atDest)) {
            // Chain is trapped against the opposite wall. The advancing wall
            // crushes the adjacent poxel and still moves in.
            const crushed = chain[0];
            clearedWave.push(toIndex(row, crushed.col));
            clearedWaveTones[toIndex(row, crushed.col)] = crushed.cell.tone;
            board[toIndex(row, crushed.col)] = null;
            crushedCount++;
          } else {
            clearedWave.push(toIndex(row, destCol));
            clearedWaveTones[toIndex(row, destCol)] = atDest.tone;
            board[toIndex(row, destCol)] = null;
            crushedCount++;
            crushedCount++;
            for (let i = chain.length - 2; i >= 0; i--) {
              board[toIndex(row, chain[i].col + 1)] = { ...chain[i].cell, isFill: false, pushDir: 'l' };
            }
            if (chain.length === 1) board[toIndex(row, frontCol)] = null;
          }
        } else {
          for (let i = chain.length - 1; i >= 0; i--) {
            board[toIndex(row, chain[i].col + 1)] = { ...chain[i].cell, isFill: false, pushDir: 'l' };
          }
        }
      }

      // New wall cell — isFill triggers the slide-in animation
      if (!skipLeftWall) {
        board[toIndex(row, leftNewCol)] = { tone, groupId: 'crunch-wall-l', isFill: true };
      }
    }

    // === RIGHT WALL — advance one step inward if it won't hit the left wall's target ===
    // Reads board (not old) for chain collection so it sees poxels already shifted by the left pass.
    let skipRightWall = false;
    if (advanceRight && rightNewCol >= leftNewCol && (!advanceLeft || rightNewCol > leftNewCol)) {
      const chain = [];
      for (let col = rightNewCol; col >= 0; col--) {
        const cell = board[toIndex(row, col)];
        if (cell !== null && !isCrunchWall(cell)) chain.push({ col, cell });
        else break;
      }

      if (chain.length > 0) {
        const frontCol = chain[chain.length - 1].col;
        const destCol = frontCol - 1;
        const atDest = board[toIndex(row, destCol)];

        if (atDest !== null) {
          if (isCrunchWall(atDest)) {
            // Chain is trapped against the opposite wall. The advancing wall
            // crushes the adjacent poxel and still moves in.
            const crushed = chain[0];
            clearedWave.push(toIndex(row, crushed.col));
            clearedWaveTones[toIndex(row, crushed.col)] = crushed.cell.tone;
            board[toIndex(row, crushed.col)] = null;
            crushedCount++;
          } else {
            clearedWave.push(toIndex(row, destCol));
            clearedWaveTones[toIndex(row, destCol)] = atDest.tone;
            board[toIndex(row, destCol)] = null;
            crushedCount++;
            crushedCount++;
            for (let i = chain.length - 2; i >= 0; i--) {
              board[toIndex(row, chain[i].col - 1)] = { ...chain[i].cell, isFill: false, pushDir: 'r' };
            }
            if (chain.length === 1) board[toIndex(row, frontCol)] = null;
          }
        } else {
          for (let i = chain.length - 1; i >= 0; i--) {
            board[toIndex(row, chain[i].col - 1)] = { ...chain[i].cell, isFill: false, pushDir: 'r' };
          }
        }
      }

      if (!skipRightWall) {
        // Check for a stray poxel at rightNewCol — only relevant when the chain was empty.
        const atRightNew = board[toIndex(row, rightNewCol)];
        if (chain.length === 0 && atRightNew !== null && !isCrunchWall(atRightNew)) {
          clearedWave.push(toIndex(row, rightNewCol));
          clearedWaveTones[toIndex(row, rightNewCol)] = atRightNew.tone;
          crushedCount++;
        }
        if (atRightNew === null || !isCrunchWall(atRightNew)) {
          board[toIndex(row, rightNewCol)] = { tone, groupId: 'crunch-wall-r', isFill: true };
        }
      }
    }
  }

  // Collect any complete rows formed by walls + poxels after the wave.
  // Walls are excluded — they only pop when the *user* deliberately completes a line.
  // Poxels in that line still get the crunch → rumble → pop treatment.
  const postWaveClears = findCrunchWaveAutoClears(board);
  const pendingClears = [...postWaveClears]
    .filter((idx) => !isCrunchWall(board[idx]))
    .map((idx) => ({ idx, tone: board[idx]?.tone ?? tone }));

  // Crunch mode only ends when the left/right walls touch on any row. We do not
  // end on "no legal moves" because the next wall wave can push, crush, or clear
  // poxels and make tray pieces playable again.
  const gameOver = haveCrunchWallsJoined(board);

  return {
    game: {
      ...game,
      board,
      preview: null,
      selectedPieceId: null,
      gameOver,
      cleared: clearedWave,
      clearedTones: clearedWaveTones,
    },
    crushedCount,
    // Cells that completed a row/col this wave. Caller should show a brief rumble
    // animation on these cells before applying the actual clear.
    pendingClears,
  };
}

export function canCrunchWallAdvance(board, side) {
  for (let row = 0; row < GRID_SIZE; row++) {
    let leftFront = -1;
    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = board[toIndex(row, col)];
      if (cell !== null && cell.groupId === 'crunch-wall-l') leftFront = col;
      else break;
    }

    let rightFront = GRID_SIZE;
    for (let col = GRID_SIZE - 1; col >= 0; col--) {
      const cell = board[toIndex(row, col)];
      if (cell !== null && cell.groupId === 'crunch-wall-r') rightFront = col;
      else break;
    }

    const leftNewCol = leftFront + 1;
    const rightNewCol = rightFront - 1;

    if (side === 'left' && leftNewCol <= rightNewCol) return true;
    if (side === 'right' && rightNewCol >= leftNewCol) return true;
  }

  return false;
}

// Apply post-wave auto-clears that were deferred for the rumble animation.
// Call this after the ~380 ms rumble window has elapsed.
// pendingClears only contains poxels (walls were filtered out in applyCrunchWave).
export function applyWavePendingClears(game, pendingClears) {
  if (!pendingClears || pendingClears.length === 0) return game;
  const board = game.board.slice();
  const clearedWave = [];
  const clearedWaveTones = {};
  for (const { idx, tone } of pendingClears) {
    if (board[idx] !== null) {
      if (!isCrunchWall(board[idx])) {
        clearedWaveTones[idx] = board[idx].tone ?? tone;
        clearedWave.push(idx);
        board[idx] = null;
      }
    }
  }
  return { ...game, board, cleared: clearedWave, clearedTones: clearedWaveTones };
}
