export const GRID_SIZE = 8;
export const TRAY_SIZE = 3;
export const TONES = ["coral", "gold", "mint", "sky", "orchid"] as const;
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
  { name: "square-3", cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]] },
  { name: "l-3", cells: [[0, 0], [0, 1], [1, 1]] },
  { name: "l-4", cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: "j-4", cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
  { name: "t-4", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: "zig-4", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { name: "s-4", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: "step-5", cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
] as const;

const SHAPE_BASE_WEIGHTS: Record<string, number> = {
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

const SHAPE_FAMILIES: Record<string, string> = {
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

export type Move = {
  pieceId: number;
  row: number;
  col: number;
};

export type BoardCell = {
  tone: string;
  groupId: number;
} | null;

export type Piece = {
  id: number;
  shape: (typeof SHAPES)[number];
  tone: string;
  bounds: {
    width: number;
    height: number;
  };
};

export type GameState = {
  board: BoardCell[];
  tray: Array<Piece | null>;
  nextPieceId: number;
  rngState: number;
  score: number;
  bestScore: number;
  combo: number;
  bestCombo: number;
  bestMoveScore: number;
  bestLinesCleared: number;
  moveCount: number;
  selectedPieceId: number | null;
  preview: null;
  gameOver: boolean;
  cleared: number[];
  clearedTones: Record<number, string>;
};

export function hashSeed(seed: string) {
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

export function getShapeBounds(shape: (typeof SHAPES)[number]) {
  const width = Math.max(...shape.cells.map(([dx]) => dx)) + 1;
  const height = Math.max(...shape.cells.map(([, dy]) => dy)) + 1;
  return { width, height };
}

export function toIndex(row: number, col: number) {
  return row * GRID_SIZE + col;
}

export function canPlace(board: BoardCell[], piece: Piece, row: number, col: number) {
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

function countPlacements(board: BoardCell[], shape: (typeof SHAPES)[number]) {
  const probe: Piece = {
    id: -1,
    shape,
    tone: TONES[0],
    bounds: getShapeBounds(shape),
  };
  let count = 0;

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      if (canPlace(board, probe, row, col)) {
        count += 1;
      }
    }
  }

  return count;
}

function getShapeFamily(shape: (typeof SHAPES)[number]) {
  return SHAPE_FAMILIES[shape.name] ?? shape.name;
}

function getShapeWeight(
  board: BoardCell[],
  shape: (typeof SHAPES)[number],
  trayShapes: Array<(typeof SHAPES)[number]>,
  requirePlaceable: boolean,
) {
  const placements = countPlacements(board, shape);

  if (requirePlaceable && placements === 0) {
    return 0;
  }

  let weight = SHAPE_BASE_WEIGHTS[shape.name] ?? 1;

  if (requirePlaceable) {
    const fillRatio = board.reduce((count, cell) => count + (cell ? 1 : 0), 0) / board.length;

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

function pickWeightedShape(
  board: BoardCell[],
  rngState: number,
  trayShapes: Array<(typeof SHAPES)[number]>,
  requirePlaceable: boolean,
) {
  const weights = SHAPES.map((shape) => getShapeWeight(board, shape, trayShapes, requirePlaceable));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shapePick = nextRandomValue(rngState);

  if (totalWeight <= 0) {
    return {
      shape: SHAPES[Math.floor(shapePick.value * SHAPES.length) % SHAPES.length],
      rngState: shapePick.rngState,
    };
  }

  let remaining = shapePick.value * totalWeight;

  for (let index = 0; index < SHAPES.length; index += 1) {
    remaining -= weights[index];
    if (remaining <= 0) {
      return {
        shape: SHAPES[index],
        rngState: shapePick.rngState,
      };
    }
  }

  return {
    shape: SHAPES[SHAPES.length - 1],
    rngState: shapePick.rngState,
  };
}

function createRandomPiece(
  board: BoardCell[],
  trayShapes: Array<(typeof SHAPES)[number]>,
  nextPieceId: number,
  rngState: number,
  requirePlaceable: boolean,
) {
  const shapePick = pickWeightedShape(board, rngState, trayShapes, requirePlaceable);
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

const SLOT_PLACEABLE_THRESHOLDS = [1.0, 0.8, 0.5];

function buildTray(board: BoardCell[], nextPieceId: number, rngState: number) {
  let tray: Piece[] = [];
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

    const pieceState = createRandomPiece(board, tray.map((entry) => entry.shape), currentPieceId, currentRngState, requirePlaceable);
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
        const pieceState = createRandomPiece(board, tray.map((entry) => entry.shape), currentPieceId, currentRngState, true);
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

export function createGameState(seed: string): GameState {
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

export function findPiece(tray: Array<Piece | null>, pieceId: number) {
  return tray.find((piece) => piece?.id === pieceId) ?? null;
}

export function findClears(board: BoardCell[]) {
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

export function countLines(clearedIndices: Set<number>) {
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

export function applyPlacement(game: GameState, pieceId: number, row: number, col: number) {
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
  const burstScore = linesCleared * linesCleared * 120;
  const moveScore = blocksPlaced * 10 + burstScore * comboMultiplier;
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

export function parseMoves(rawMoves: unknown) {
  if (!Array.isArray(rawMoves)) {
    return null;
  }

  const moves: Move[] = [];

  for (const rawMove of rawMoves) {
    const pieceId = Number.parseInt(String((rawMove as { pieceId?: unknown })?.pieceId ?? ""), 10);
    const row = Number.parseInt(String((rawMove as { row?: unknown })?.row ?? ""), 10);
    const col = Number.parseInt(String((rawMove as { col?: unknown })?.col ?? ""), 10);

    if (![pieceId, row, col].every(Number.isInteger)) {
      return null;
    }

    moves.push({ pieceId, row, col });
  }

  return moves;
}

export function movesMatchPrefix(prefix: Move[], moves: Move[]) {
  if (prefix.length > moves.length) {
    return false;
  }

  return prefix.every((move, index) =>
    move.pieceId === moves[index]?.pieceId &&
    move.row === moves[index]?.row &&
    move.col === moves[index]?.col
  );
}

export function replayRun(seed: string, moves: Move[], options: { requireGameOver?: boolean } = {}) {
  const { requireGameOver = true } = options;
  let game = createGameState(seed);

  for (const move of moves) {
    const nextGame = applyPlacement(game, move.pieceId, move.row, move.col);

    if (nextGame === game) {
      return { valid: false, error: "Run contains an invalid placement." };
    }

    game = nextGame;
  }

  if (requireGameOver && !game.gameOver) {
    return { valid: false, error: "Run is not complete." };
  }

  return { valid: true, game };
}
