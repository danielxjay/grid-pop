export const GRID_SIZE = 8;
export const TRAY_SIZE = 3;
export const STORAGE_KEY = "block-blaster-best-score";
export const TONES = ["coral", "gold", "mint", "sky", "orchid"];

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
    return Number.parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
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

export function createGameState(bestScore = loadBestScore()) {
  const board = createBoard();
  const { tray, nextPieceId } = buildTray(board, 1);

  return {
    board,
    tray,
    nextPieceId,
    score: 0,
    bestScore,
    combo: 0,
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
  const score =
    game.score + blocksPlaced * 10 + linesCleared * 120 * comboMultiplier;
  const bestScore = Math.max(score, game.bestScore);

  let tray = game.tray.map((entry) => (entry?.id === pieceId ? null : entry));
  let nextPieceId = game.nextPieceId;

  if (tray.every((entry) => entry === null)) {
    const nextTrayState = buildTray(board, nextPieceId);
    tray = nextTrayState.tray;
    nextPieceId = nextTrayState.nextPieceId;
  }

  const gameOver = !tray.some((entry) => entry && hasAnyPlacement(board, entry));

  return {
    ...game,
    board,
    tray,
    nextPieceId,
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

function buildTray(board, nextPieceId) {
  let tray = [];
  let currentPieceId = nextPieceId;

  for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
    const pieceState = createRandomPiece(currentPieceId);
    tray.push(pieceState.piece);
    currentPieceId = pieceState.nextPieceId;
  }

  if (hasPotentialMove(board)) {
    let attempts = 0;

    while (attempts < 40 && !tray.some((piece) => hasAnyPlacement(board, piece))) {
      tray = [];
      currentPieceId = nextPieceId;

      for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
        const pieceState = createRandomPiece(currentPieceId);
        tray.push(pieceState.piece);
        currentPieceId = pieceState.nextPieceId;
      }

      attempts += 1;
    }
  }

  return {
    tray,
    nextPieceId: currentPieceId,
  };
}

function createRandomPiece(nextPieceId) {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const tone = TONES[Math.floor(Math.random() * TONES.length)];

  return {
    piece: {
      id: nextPieceId,
      shape,
      tone,
      bounds: getShapeBounds(shape),
    },
    nextPieceId: nextPieceId + 1,
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
