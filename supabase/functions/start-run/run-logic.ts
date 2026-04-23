const GRID_SIZE = 8;
const TRAY_SIZE = 3;
const TONES = ["coral", "gold", "mint", "sky", "orchid"] as const;
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
