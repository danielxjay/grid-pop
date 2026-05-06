const BOARD_SIZE = 5;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

export function createEmptyBoard() {
  return Array.from({ length: BOARD_CELLS }, () => 0);
}

function getAdjacentIndexes(index) {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  return [
    [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
  ]
    .map(([dr, dc]) => [row + dr, col + dc])
    .filter(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE)
    .map(([r, c]) => r * BOARD_SIZE + c);
}

export function toggleAt(board, index) {
  const next = [...board];
  for (const i of getAdjacentIndexes(index)) {
    next[i] = next[i] === 1 ? 0 : 1;
  }
  return next;
}

export function isSolved(board) {
  return board.every((cell) => cell === 0);
}
