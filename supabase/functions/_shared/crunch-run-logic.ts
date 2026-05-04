export const GRID_SIZE = 8;
export const TRAY_SIZE = 3;
export const TONES = ["coral", "gold", "mint", "sky", "orchid"] as const;
export const CRUNCH_SHAPES = [
  { name: "single", cells: [[0, 0]] },
  { name: "bar-2", cells: [[0, 0], [1, 0]] },
  { name: "bar-3", cells: [[0, 0], [1, 0], [2, 0]] },
  { name: "col-2", cells: [[0, 0], [0, 1]] },
  { name: "col-3", cells: [[0, 0], [0, 1], [0, 2]] },
  { name: "square-2", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: "l-3", cells: [[0, 0], [0, 1], [1, 1]] },
] as const;

const SHAPE_BASE_WEIGHTS: Record<string, number> = {
  single: 1.15,
  "bar-2": 1.05,
  "col-2": 1.0,
  "bar-3": 1.03,
  "col-3": 1.0,
  "square-2": 1.0,
  "l-3": 0.97,
};

const SHAPE_FAMILIES: Record<string, string> = {
  single: "single",
  "bar-2": "line",
  "bar-3": "line",
  "col-2": "line",
  "col-3": "line",
  "square-2": "square",
  "l-3": "hook",
};

const SLOT_PLACEABLE_THRESHOLDS = [1.0, 0.8, 0.5] as const;
export const CRUNCH_CRITICAL_DURATION_MS = 5000;
export const CRUNCH_LINE_TIME_BONUS_MS = 1000;
export const CRUNCH_WALL_CELL_TIME_BONUS_MS = 100;

export type CrunchMove = {
  pieceId: number;
  row: number;
  col: number;
  atMs: number;
};

export type BoardCell =
  | {
      tone: string;
      groupId: number | string;
      isFill?: boolean;
      pushDir?: "l" | "r";
    }
  | null;

export type Piece = {
  id: number;
  shape: (typeof CRUNCH_SHAPES)[number];
  tone: string;
  bounds: {
    width: number;
    height: number;
  };
};

export type CrunchGameState = {
  board: BoardCell[];
  tray: Array<Piece | null>;
  nextPieceId: number;
  trayRngState: number;
  wallRngState: number;
  score: number;
  combo: number;
  bestCombo: number;
  bestMoveScore: number;
  bestLinesCleared: number;
  moveCount: number;
  cleared: number[];
  clearedTones: Record<number, string>;
  clearedLineCount: number;
  clearedWallCount: number;
  crunchPoxelsPopped: number;
  totalLinesCleared: number;
  totalWallCellsCleared: number;
  totalTimeBonusMs: number;
  criticalEscapes: number;
  crunchWallDepth: number;
  gameOver: boolean;
  criticalUntilMs: number | null;
  nextWaveAtMs: number | null;
  elapsedMs: number;
};

const GRID_ROW_INDICES = Array.from({ length: GRID_SIZE }, (_, row) =>
  Array.from({ length: GRID_SIZE }, (_, col) => toIndex(row, col))
);
const GRID_COL_INDICES = Array.from({ length: GRID_SIZE }, (_, col) =>
  Array.from({ length: GRID_SIZE }, (_, row) => toIndex(row, col))
);

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

export function toIndex(row: number, col: number) {
  return row * GRID_SIZE + col;
}

export function getShapeBounds(shape: (typeof CRUNCH_SHAPES)[number]) {
  let maxX = 0;
  let maxY = 0;
  for (const [dx, dy] of shape.cells) {
    if (dx > maxX) maxX = dx;
    if (dy > maxY) maxY = dy;
  }
  return { width: maxX + 1, height: maxY + 1 };
}

export function canPlace(board: BoardCell[], piece: Piece, row: number, col: number) {
  const bounds = getShapeBounds(piece.shape);
  if (row < 0 || col < 0 || row + bounds.height > GRID_SIZE || col + bounds.width > GRID_SIZE) {
    return false;
  }

  for (const [dx, dy] of piece.shape.cells) {
    if (board[toIndex(row + dy, col + dx)] !== null) {
      return false;
    }
  }

  return true;
}

function getPlacementProbe(shape: (typeof CRUNCH_SHAPES)[number]): Piece {
  return {
    id: -1,
    shape,
    tone: TONES[0],
    bounds: getShapeBounds(shape),
  };
}

function hasAnyPlacement(board: BoardCell[], piece: Piece) {
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

function countPlacements(board: BoardCell[], shape: (typeof CRUNCH_SHAPES)[number]) {
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

function getShapeFamily(shape: (typeof CRUNCH_SHAPES)[number]) {
  return SHAPE_FAMILIES[shape.name] ?? shape.name;
}

function getShapeWeight(
  board: BoardCell[],
  shape: (typeof CRUNCH_SHAPES)[number],
  trayShapes: Array<(typeof CRUNCH_SHAPES)[number]>,
  requirePlaceable: boolean,
  fillRatio: number,
) {
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
    } else if (fillRatio >= 0.5) {
      if (shape.cells.length <= 2) weight *= 1.03;
    }
  }

  const family = getShapeFamily(shape);
  const repeatedFamilyCount = trayShapes.filter((entry) => getShapeFamily(entry) === family).length;
  if (repeatedFamilyCount === 1) weight *= 0.8;
  else if (repeatedFamilyCount >= 2) weight *= 0.6;

  return weight;
}

function pickWeightedShape(
  board: BoardCell[],
  rngState: number,
  trayShapes: Array<(typeof CRUNCH_SHAPES)[number]>,
  requirePlaceable: boolean,
) {
  const fillRatio = requirePlaceable
    ? board.reduce((count, cell) => count + (cell ? 1 : 0), 0) / board.length
    : 0;
  const weights = CRUNCH_SHAPES.map((shape) =>
    getShapeWeight(board, shape, trayShapes, requirePlaceable, fillRatio)
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shapePick = nextRandomValue(rngState);

  if (totalWeight <= 0) {
    return {
      shape: CRUNCH_SHAPES[Math.floor(shapePick.value * CRUNCH_SHAPES.length) % CRUNCH_SHAPES.length],
      rngState: shapePick.rngState,
    };
  }

  let remaining = shapePick.value * totalWeight;
  for (let index = 0; index < CRUNCH_SHAPES.length; index += 1) {
    remaining -= weights[index];
    if (remaining <= 0) {
      return { shape: CRUNCH_SHAPES[index], rngState: shapePick.rngState };
    }
  }

  return { shape: CRUNCH_SHAPES[CRUNCH_SHAPES.length - 1], rngState: shapePick.rngState };
}

function createRandomPiece(
  board: BoardCell[],
  trayShapes: Array<(typeof CRUNCH_SHAPES)[number]>,
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
    } as Piece,
    nextPieceId: nextPieceId + 1,
    rngState: tonePick.rngState,
  };
}

function countPlaceableShapes(board: BoardCell[]) {
  let count = 0;
  for (const shape of CRUNCH_SHAPES) {
    if (hasAnyPlacement(board, getPlacementProbe(shape))) {
      count += 1;
    }
  }
  return count;
}

function countPlayableTrayShapes(board: BoardCell[], tray: Piece[]) {
  const playableShapeNames = new Set<string>();
  for (const piece of tray) {
    if (piece && hasAnyPlacement(board, piece)) {
      playableShapeNames.add(piece.shape.name);
    }
  }
  return playableShapeNames.size;
}

function buildTray(board: BoardCell[], nextPieceId: number, rngState: number) {
  let tray: Piece[] = [];
  let trayShapes: Array<(typeof CRUNCH_SHAPES)[number]> = [];
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

    const pieceState = createRandomPiece(board, trayShapes, currentPieceId, currentRngState, requirePlaceable);
    tray.push(pieceState.piece);
    trayShapes.push(pieceState.piece.shape);
    currentPieceId = pieceState.nextPieceId;
    currentRngState = pieceState.rngState;
  }

  const requiredPlayableCount = Math.min(2, countPlaceableShapes(board));
  if (requiredPlayableCount > 0) {
    let attempts = 0;
    while (attempts < 40 && countPlayableTrayShapes(board, tray) < requiredPlayableCount) {
      tray = [];
      trayShapes = [];
      currentPieceId = nextPieceId;

      for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
        const pieceState = createRandomPiece(board, trayShapes, currentPieceId, currentRngState, true);
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

export function isCrunchWall(cell: BoardCell) {
  return cell !== null && typeof cell.groupId === "string" && cell.groupId.startsWith("crunch-wall");
}

function getCompletedLineSets(board: BoardCell[]) {
  const rows = new Set<number>();
  const cols = new Set<number>();

  for (let row = 0; row < GRID_ROW_INDICES.length; row += 1) {
    const rowIndices = GRID_ROW_INDICES[row];
    if (rowIndices.every((i) => board[i] !== null) && rowIndices.some((i) => !isCrunchWall(board[i]))) {
      rows.add(row);
    }
  }

  for (let col = 0; col < GRID_COL_INDICES.length; col += 1) {
    const colIndices = GRID_COL_INDICES[col];
    if (colIndices.every((i) => board[i] !== null) && colIndices.some((i) => !isCrunchWall(board[i]))) {
      cols.add(col);
    }
  }

  return { rows, cols };
}

function findNewlyClearedIndices(previousBoard: BoardCell[], nextBoard: BoardCell[]) {
  const previousLines = getCompletedLineSets(previousBoard);
  const nextLines = getCompletedLineSets(nextBoard);
  const cleared = new Set<number>();

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

function countLines(clearedIndices: Set<number>, board: BoardCell[]) {
  let lines = 0;

  for (const rowIndices of GRID_ROW_INDICES) {
    if (rowIndices.every((i) => clearedIndices.has(i)) && rowIndices.some((i) => !isCrunchWall(board[i]))) {
      lines += 1;
    }
  }
  for (const colIndices of GRID_COL_INDICES) {
    if (colIndices.every((i) => clearedIndices.has(i)) && colIndices.some((i) => !isCrunchWall(board[i]))) {
      lines += 1;
    }
  }

  return lines;
}

function findCrunchWaveAutoClears(board: BoardCell[]) {
  const cleared = new Set<number>();

  for (const rowIndices of GRID_ROW_INDICES) {
    if (rowIndices.every((i) => board[i] !== null) && rowIndices.some((i) => !isCrunchWall(board[i]))) {
      rowIndices.forEach((i) => cleared.add(i));
    }
  }

  for (let row = 0; row < GRID_SIZE; row += 1) {
    let col = 0;
    while (col < GRID_SIZE) {
      const index = toIndex(row, col);
      const cell = board[index];

      if (cell === null || isCrunchWall(cell)) {
        col += 1;
        continue;
      }

      const startCol = col;
      while (col < GRID_SIZE) {
        const runCell = board[toIndex(row, col)];
        if (runCell === null || isCrunchWall(runCell)) break;
        col += 1;
      }

      const leftCell = startCol - 1 >= 0 ? board[toIndex(row, startCol - 1)] : null;
      const rightCell = col < GRID_SIZE ? board[toIndex(row, col)] : null;
      if (isCrunchWall(leftCell) && isCrunchWall(rightCell)) {
        for (let trappedCol = startCol; trappedCol < col; trappedCol += 1) {
          cleared.add(toIndex(row, trappedCol));
        }
      }
    }
  }

  return cleared;
}

function countCrunchClearedPoxels(previousBoard: BoardCell[], clearedIndices: number[]) {
  return clearedIndices.reduce((count, index) => (isCrunchWall(previousBoard[index]) ? count : count + 1), 0);
}

export function getCrunchFrameInterval(elapsedMs: number) {
  const s = elapsedMs / 1000;
  if (s < 45) return 6000;
  if (s < 90) return 5000;
  if (s < 150) return 4000;
  return 3000;
}

function canCrunchWallAdvance(board: BoardCell[], side: "left" | "right") {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    let leftFront = -1;
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const cell = board[toIndex(row, col)];
      if (cell !== null && cell.groupId === "crunch-wall-l") leftFront = col;
      else break;
    }

    let rightFront = GRID_SIZE;
    for (let col = GRID_SIZE - 1; col >= 0; col -= 1) {
      const cell = board[toIndex(row, col)];
      if (cell !== null && cell.groupId === "crunch-wall-r") rightFront = col;
      else break;
    }

    const leftNewCol = leftFront + 1;
    const rightNewCol = rightFront - 1;
    if (side === "left" && leftNewCol <= rightNewCol) return true;
    if (side === "right" && rightNewCol >= leftNewCol) return true;
  }
  return false;
}

function getCrunchWaveAdvance(elapsedMs: number, board: BoardCell[], wallRngState: number) {
  if (elapsedMs < 90000) {
    const roll = nextRandomValue(wallRngState);
    const preferLeft = roll.value < 0.5;
    const preferredSide = preferLeft ? "left" : "right";
    const fallbackSide = preferLeft ? "right" : "left";

    if (canCrunchWallAdvance(board, preferredSide)) {
      return {
        advance: preferLeft
          ? { advanceLeft: true, advanceRight: false }
          : { advanceLeft: false, advanceRight: true },
        wallRngState: roll.rngState,
      };
    }
    if (canCrunchWallAdvance(board, fallbackSide)) {
      return {
        advance: preferLeft
          ? { advanceLeft: false, advanceRight: true }
          : { advanceLeft: true, advanceRight: false },
        wallRngState: roll.rngState,
      };
    }

    return { advance: { advanceLeft: false, advanceRight: false }, wallRngState: roll.rngState };
  }

  return { advance: { advanceLeft: true, advanceRight: true }, wallRngState };
}

export function getCrunchTouchingWallCells(board: BoardCell[]) {
  const touching: number[] = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    let leftFront = -1;
    let rightFront = GRID_SIZE;

    for (let col = 0; col < GRID_SIZE; col += 1) {
      const cell = board[toIndex(row, col)];
      if (cell !== null && cell.groupId === "crunch-wall-l") leftFront = Math.max(leftFront, col);
      else if (cell !== null && cell.groupId === "crunch-wall-r") rightFront = Math.min(rightFront, col);
    }

    if (leftFront !== -1 && rightFront !== GRID_SIZE && leftFront + 1 >= rightFront) {
      touching.push(toIndex(row, leftFront), toIndex(row, rightFront));
    }
  }

  return touching;
}

export function haveCrunchWallsJoined(board: BoardCell[]) {
  return getCrunchTouchingWallCells(board).length > 0;
}

export function getCrunchTimeBonusMs(linesCleared: number, wallCellsCleared: number) {
  if (!Number.isFinite(linesCleared) || linesCleared <= 0) return 0;
  return (linesCleared * CRUNCH_LINE_TIME_BONUS_MS) + (Math.max(0, wallCellsCleared) * CRUNCH_WALL_CELL_TIME_BONUS_MS);
}

export function computeCrunchRating(survivalMs: number, poxelsPopped: number) {
  const seconds = survivalMs / 1000;
  return Math.round(seconds * 10 * (1 + poxelsPopped / 100));
}

function applyWavePendingClears(game: CrunchGameState, pendingClears: Array<{ idx: number; tone: string }>) {
  if (!pendingClears.length) return game;
  const board = game.board.slice();
  let popped = 0;

  for (const { idx } of pendingClears) {
    if (board[idx] !== null && !isCrunchWall(board[idx])) {
      board[idx] = null;
      popped += 1;
    }
  }

  return {
    ...game,
    board,
    crunchPoxelsPopped: game.crunchPoxelsPopped + popped,
  };
}

export function applyCrunchWave(
  game: CrunchGameState,
  tone: string,
  elapsedMs: number,
  advance: { advanceLeft: boolean; advanceRight: boolean },
) {
  const old = game.board;
  const board = old.map((cell) => {
    if (cell === null) return null;
    const stripPush = cell.pushDir != null;
    const stripFill = cell.isFill && isCrunchWall(cell);
    if (!stripPush && !stripFill) return cell;
    return { ...cell, pushDir: undefined, isFill: stripFill ? false : cell.isFill };
  });

  for (let row = 0; row < GRID_SIZE; row += 1) {
    let leftFront = -1;
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const cell = old[toIndex(row, col)];
      if (cell !== null && cell.groupId === "crunch-wall-l") leftFront = col;
      else break;
    }
    let rightFront = GRID_SIZE;
    for (let col = GRID_SIZE - 1; col >= 0; col -= 1) {
      const cell = old[toIndex(row, col)];
      if (cell !== null && cell.groupId === "crunch-wall-r") rightFront = col;
      else break;
    }

    const leftNewCol = leftFront + 1;
    const rightNewCol = rightFront - 1;

    if (advance.advanceLeft && leftNewCol <= rightNewCol) {
      const chain: Array<{ col: number; cell: NonNullable<BoardCell> }> = [];
      for (let col = leftNewCol; col < GRID_SIZE; col += 1) {
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
            board[toIndex(row, chain[0].col)] = null;
          } else {
            board[toIndex(row, destCol)] = null;
            for (let i = chain.length - 2; i >= 0; i -= 1) {
              board[toIndex(row, chain[i].col + 1)] = { ...chain[i].cell, isFill: false, pushDir: "l" };
            }
            if (chain.length === 1) board[toIndex(row, frontCol)] = null;
          }
        } else {
          for (let i = chain.length - 1; i >= 0; i -= 1) {
            board[toIndex(row, chain[i].col + 1)] = { ...chain[i].cell, isFill: false, pushDir: "l" };
          }
        }
      }

      board[toIndex(row, leftNewCol)] = { tone, groupId: "crunch-wall-l", isFill: true };
    }

    if (advance.advanceRight && rightNewCol >= leftNewCol && (!advance.advanceLeft || rightNewCol > leftNewCol)) {
      const chain: Array<{ col: number; cell: NonNullable<BoardCell> }> = [];
      for (let col = rightNewCol; col >= 0; col -= 1) {
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
            board[toIndex(row, chain[0].col)] = null;
          } else {
            board[toIndex(row, destCol)] = null;
            for (let i = chain.length - 2; i >= 0; i -= 1) {
              board[toIndex(row, chain[i].col - 1)] = { ...chain[i].cell, isFill: false, pushDir: "r" };
            }
            if (chain.length === 1) board[toIndex(row, frontCol)] = null;
          }
        } else {
          for (let i = chain.length - 1; i >= 0; i -= 1) {
            board[toIndex(row, chain[i].col - 1)] = { ...chain[i].cell, isFill: false, pushDir: "r" };
          }
        }
      }

      const atRightNew = board[toIndex(row, rightNewCol)];
      if (atRightNew === null || !isCrunchWall(atRightNew)) {
        board[toIndex(row, rightNewCol)] = { tone, groupId: "crunch-wall-r", isFill: true };
      }
    }
  }

  const pendingClears = [...findCrunchWaveAutoClears(board)]
    .filter((idx) => !isCrunchWall(board[idx]))
    .map((idx) => ({ idx, tone: board[idx]?.tone ?? tone }));

  let nextGame: CrunchGameState = {
    ...game,
    board,
    elapsedMs,
    crunchWallDepth: game.crunchWallDepth + 1,
    gameOver: false,
  };

  nextGame = applyWavePendingClears(nextGame, pendingClears);
  if (haveCrunchWallsJoined(nextGame.board)) {
    nextGame.criticalUntilMs = elapsedMs + CRUNCH_CRITICAL_DURATION_MS;
    nextGame.nextWaveAtMs = null;
  } else {
    nextGame.criticalUntilMs = null;
    nextGame.nextWaveAtMs = elapsedMs + getCrunchFrameInterval(elapsedMs);
  }

  return nextGame;
}

export function createCrunchGameState(traySeed: string, wallSeed: string): CrunchGameState {
  const board = createBoard();
  const trayInitial = buildTray(board, 1, hashSeed(traySeed));
  let game: CrunchGameState = {
    board,
    tray: trayInitial.tray,
    nextPieceId: trayInitial.nextPieceId,
    trayRngState: trayInitial.rngState,
    wallRngState: hashSeed(wallSeed),
    score: 0,
    combo: 0,
    bestCombo: 0,
    bestMoveScore: 0,
    bestLinesCleared: 0,
    moveCount: 0,
    cleared: [],
    clearedTones: {},
    clearedLineCount: 0,
    clearedWallCount: 0,
    crunchPoxelsPopped: 0,
    totalLinesCleared: 0,
    totalWallCellsCleared: 0,
    totalTimeBonusMs: 0,
    criticalEscapes: 0,
    crunchWallDepth: 0,
    gameOver: false,
    criticalUntilMs: null,
    nextWaveAtMs: null,
    elapsedMs: 0,
  };

  game = applyCrunchWave(game, TONES[0], 0, { advanceLeft: true, advanceRight: true });
  game.nextWaveAtMs = getCrunchFrameInterval(0);
  return game;
}

export function applyCrunchPlacement(game: CrunchGameState, pieceId: number, row: number, col: number, atMs: number) {
  const piece = game.tray.find((entry) => entry?.id === pieceId) ?? null;
  if (!piece || !canPlace(game.board, piece, row, col)) {
    return game;
  }

  const board = [...game.board];
  for (const [dx, dy] of piece.shape.cells) {
    board[toIndex(row + dy, col + dx)] = { tone: piece.tone, groupId: piece.id };
  }

  const newlyClearedIndices = findNewlyClearedIndices(game.board, board);
  const blocksPlaced = piece.shape.cells.length;
  const previousCombo = game.combo;
  let combo = 0;
  let cleared: number[] = [];
  const clearedTones: Record<number, string> = {};

  if (newlyClearedIndices.size > 0) {
    for (const index of newlyClearedIndices) {
      clearedTones[index] = piece.tone;
      board[index] = null;
    }
    combo = previousCombo + 1;
    cleared = [...newlyClearedIndices];
  }

  const linesCleared = countLines(newlyClearedIndices, board);
  const clearedWallCount = [...newlyClearedIndices].reduce((count, index) => (
    isCrunchWall(game.board[index]) ? count + 1 : count
  ), 0);
  const comboMultiplier = Math.max(1, combo + 1);
  const burstScore = linesCleared * linesCleared * 180;
  const clearBonusScore = burstScore * comboMultiplier;
  const moveScore = blocksPlaced * 15 + clearBonusScore;
  const score = game.score + moveScore;
  const bestCombo = Math.max(game.bestCombo, combo);
  const bestMoveScore = Math.max(game.bestMoveScore, moveScore);
  const bestLinesCleared = Math.max(game.bestLinesCleared, linesCleared);
  const moveCount = game.moveCount + 1;

  let tray = game.tray.map((entry) => (entry?.id === pieceId ? null : entry));
  let nextPieceId = game.nextPieceId;
  let trayRngState = game.trayRngState;
  if (tray.every((entry) => entry === null)) {
    const nextTrayState = buildTray(board, nextPieceId, trayRngState);
    tray = nextTrayState.tray;
    nextPieceId = nextTrayState.nextPieceId;
    trayRngState = nextTrayState.rngState;
  }

  let nextWaveAtMs = game.nextWaveAtMs;
  let criticalUntilMs = game.criticalUntilMs;
  if (criticalUntilMs !== null) {
    if (getCrunchTouchingWallCells(board).length === 0) {
      criticalUntilMs = null;
      nextWaveAtMs = atMs + getCrunchFrameInterval(atMs);
      game = {
        ...game,
        criticalEscapes: game.criticalEscapes + 1,
      };
    }
  }

  const bonusMs = linesCleared > 0 ? getCrunchTimeBonusMs(linesCleared, clearedWallCount) : 0;
  if (linesCleared > 0) {
    if (criticalUntilMs !== null) criticalUntilMs += bonusMs;
    else if (nextWaveAtMs !== null) nextWaveAtMs += bonusMs;
  }

  return {
    ...game,
    board,
    tray,
    nextPieceId,
    trayRngState,
    score,
    combo,
    bestCombo,
    bestMoveScore,
    bestLinesCleared,
    moveCount,
    cleared,
    clearedTones,
    clearedLineCount: linesCleared,
    clearedWallCount,
    crunchPoxelsPopped: game.crunchPoxelsPopped + countCrunchClearedPoxels(game.board, cleared),
    totalLinesCleared: game.totalLinesCleared + linesCleared,
    totalWallCellsCleared: game.totalWallCellsCleared + clearedWallCount,
    totalTimeBonusMs: game.totalTimeBonusMs + bonusMs,
    criticalUntilMs,
    nextWaveAtMs,
    elapsedMs: atMs,
    gameOver: false,
  };
}

export function parseCrunchMoves(rawMoves: unknown, maxMoves = 2048) {
  if (!Array.isArray(rawMoves)) return null;
  const moves: CrunchMove[] = [];

  for (const rawMove of rawMoves.slice(0, maxMoves)) {
    const pieceId = Number.parseInt(String((rawMove as { pieceId?: unknown })?.pieceId ?? ""), 10);
    const row = Number.parseInt(String((rawMove as { row?: unknown })?.row ?? ""), 10);
    const col = Number.parseInt(String((rawMove as { col?: unknown })?.col ?? ""), 10);
    const atMs = Number.parseInt(String((rawMove as { atMs?: unknown })?.atMs ?? ""), 10);
    if (![pieceId, row, col, atMs].every(Number.isInteger) || atMs < 0) {
      return null;
    }
    moves.push({ pieceId, row, col, atMs });
  }

  return moves;
}

export function crunchMovesMatchPrefix(prefix: CrunchMove[], moves: CrunchMove[]) {
  if (prefix.length > moves.length) return false;
  return prefix.every((move, index) =>
    move.pieceId === moves[index]?.pieceId &&
    move.row === moves[index]?.row &&
    move.col === moves[index]?.col &&
    move.atMs === moves[index]?.atMs
  );
}

function advanceToTime(game: CrunchGameState, untilMs: number) {
  let current = game;

  while (true) {
    if (current.criticalUntilMs !== null) {
      if (untilMs < current.criticalUntilMs) {
        return { game: { ...current, elapsedMs: untilMs }, valid: true };
      }
      return {
        game: {
          ...current,
          elapsedMs: current.criticalUntilMs,
          gameOver: true,
        },
        valid: true,
      };
    }

    if (current.nextWaveAtMs === null || untilMs < current.nextWaveAtMs) {
      return { game: { ...current, elapsedMs: untilMs }, valid: true };
    }

    const waveAdvance = getCrunchWaveAdvance(current.nextWaveAtMs, current.board, current.wallRngState);
    current = {
      ...applyCrunchWave(current, TONES[current.crunchWallDepth % TONES.length], current.nextWaveAtMs, waveAdvance.advance),
      wallRngState: waveAdvance.wallRngState,
    };

    if (current.gameOver) {
      return { game: current, valid: true };
    }
  }
}

export function replayCrunchRun(
  traySeed: string,
  wallSeed: string,
  moves: CrunchMove[],
  options: { finishedAtMs?: number; requireGameOver?: boolean } = {},
) {
  const { finishedAtMs = null, requireGameOver = true } = options;
  let game = createCrunchGameState(traySeed, wallSeed);
  let lastAtMs = 0;

  for (const move of moves) {
    if (move.atMs < lastAtMs) {
      return { valid: false, error: "Crunch move timestamps are out of order." };
    }
    const advanced = advanceToTime(game, move.atMs);
    if (!advanced.valid || !advanced.game) {
      return { valid: false, error: "Crunch timing replay failed." };
    }
    if (advanced.game.gameOver) {
      return { valid: false, error: "Crunch run contains moves after game over." };
    }

    const nextGame = applyCrunchPlacement(advanced.game, move.pieceId, move.row, move.col, move.atMs);
    if (nextGame === advanced.game) {
      return { valid: false, error: "Crunch run contains an invalid placement." };
    }
    game = nextGame;
    lastAtMs = move.atMs;
  }

  if (finishedAtMs !== null) {
    const advanced = advanceToTime(game, finishedAtMs);
    if (!advanced.valid || !advanced.game) {
      return { valid: false, error: "Crunch finish replay failed." };
    }
    game = advanced.game;
  }

  const survivalMs = Math.max(game.elapsedMs, finishedAtMs ?? game.elapsedMs);
  const rating = computeCrunchRating(survivalMs, game.crunchPoxelsPopped);

  if (requireGameOver && !game.gameOver) {
    return { valid: false, error: "Crunch run is not complete." };
  }

  return {
    valid: true,
    game,
    score: rating,
    survivalMs,
    poxelsPopped: game.crunchPoxelsPopped,
    moveCount: game.moveCount,
    wallDepth: game.crunchWallDepth,
    linesCleared: game.totalLinesCleared,
    bestLinesCleared: game.bestLinesCleared,
    wallCellsCleared: game.totalWallCellsCleared,
    timeBonusMs: game.totalTimeBonusMs,
    criticalEscapes: game.criticalEscapes,
  };
}
