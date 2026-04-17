import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  GRID_SIZE,
  TRAY_SIZE,
  applyPlacement,
  buildPreview,
  clearClearedCells,
  clearPreview,
  createGameState,
  findClears,
  findPiece,
  loadBestScore,
  saveBestScore,
  setPreview,
  toIndex,
  togglePieceSelection,
} from "./game.js";
import {
  isSoundEnabled,
  playClearSound,
  playFillCellSound,
  playPreviewMoveSound,
  playPickupSound,
  playPlaceSound,
  primeSound,
  setSoundEnabled,
  unlockAndTestSound,
} from "./sound.js";

function PieceGrid({ piece, compact = false, cellSizeOverride = null, gapSizeOverride = null }) {
  const { width, height } = piece.bounds;
  const occupied = new Set(piece.shape.cells.map(([dx, dy]) => `${dx}:${dy}`));
  const baseCellSize = cellSizeOverride ?? (compact ? 0.95 : 1.1);
  const gapSize = gapSizeOverride ?? (compact ? 0.12 : 0.08);
  const maxWidth =
    compact || cellSizeOverride !== null
      ? width * baseCellSize + Math.max(0, width - 1) * gapSize
      : 4.35;
  const maxHeight =
    compact || cellSizeOverride !== null
      ? height * baseCellSize + Math.max(0, height - 1) * gapSize
      : 3.25;
  const fittedCellSize = Math.min(
    baseCellSize,
    (maxWidth - Math.max(0, width - 1) * gapSize) / width,
    (maxHeight - Math.max(0, height - 1) * gapSize) / height
  );

  return (
    <div
      className={`piece-grid${compact ? " is-compact" : ""}`}
      style={{
        "--cols": String(width),
        "--rows": String(height),
        "--piece-cell": `${fittedCellSize}rem`,
        "--piece-gap": `${gapSize}rem`,
      }}
    >
      {Array.from({ length: width * height }, (_, index) => {
        const row = Math.floor(index / width);
        const col = index % width;
        const filled = occupied.has(`${col}:${row}`);

        return (
          <span
            key={`${piece.id}-${row}-${col}`}
            className={`piece-cell${filled ? ` is-solid tone-${piece.tone}` : ""}`}
          />
        );
      })}
    </div>
  );
}

function SpeakerIcon({ on }) {
  return (
    <svg viewBox="0 0 20 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="2,5.5 6,5.5 10,2 10,14 6,10.5 2,10.5" fill="currentColor" stroke="none" />
      {on ? (
        <>
          <path d="M12 6a3 3 0 0 1 0 4" />
          <path d="M14.5 3.5a6.5 6.5 0 0 1 0 9" />
        </>
      ) : (
        <>
          <line x1="13" y1="5" x2="18" y2="11" />
          <line x1="18" y1="5" x2="13" y2="11" />
        </>
      )}
    </svg>
  );
}

function ScorePanel({ score, bestScore, combo }) {
  return (
    <section className="score-panel">
      <div className="score-stat">
        <p className="section-label">Run Score</p>
        <strong className="score-value">{score}</strong>
      </div>
      <div className="score-stat">
        <p className="section-label">Best</p>
        <strong className="score-value">{bestScore}</strong>
      </div>
      <div className="score-stat">
        <p className="section-label">Combo</p>
        <strong className="score-value">x{Math.max(1, combo + 1)}</strong>
      </div>
    </section>
  );
}

function Tray({ tray, selectedPieceId, gameOver, started, onSelectPiece, onStartDrag }) {
  return (
    <div className="tray" aria-label="Available shapes">
      {Array.from({ length: TRAY_SIZE }, (_, index) => {
        const piece = tray[index];

        if (!piece) {
          return (
            <button key={`empty-${index}`} className="piece-button is-empty" type="button" disabled />
          );
        }

        return (
          <button
            key={piece.id}
            className={`piece-button${selectedPieceId === piece.id ? " is-selected" : ""}`}
            type="button"
            data-piece-id={piece.id}
            aria-label={`${piece.shape.name} piece`}
            onClick={() => onSelectPiece(piece.id)}
            onPointerDown={(event) => onStartDrag(piece, event)}
            disabled={gameOver || !started}
          >
            <PieceGrid piece={piece} />
          </button>
        );
      })}
    </div>
  );
}


function Board({
  boardRef,
  board,
  clearedSet,
  clearedTones,
  previewClearSet,
  previewTone,
  started,
  onBoardMove,
  onBoardLeave,
  onCellClick,
}) {
  // Determine which rows/cols are fully cleared so we can stagger per-axis
  const clearedRows = new Set();
  const clearedCols = new Set();
  if (clearedSet.size > 0) {
    for (let r = 0; r < GRID_SIZE; r++) {
      if (Array.from({ length: GRID_SIZE }, (_, c) => toIndex(r, c)).every((i) => clearedSet.has(i))) {
        clearedRows.add(r);
      }
    }
    for (let c = 0; c < GRID_SIZE; c++) {
      if (Array.from({ length: GRID_SIZE }, (_, r) => toIndex(r, c)).every((i) => clearedSet.has(i))) {
        clearedCols.add(c);
      }
    }
  }

  return (
    <div
      ref={boardRef}
      className="board"
      aria-label="Game board"
      onPointerMove={onBoardMove}
      onPointerLeave={onBoardLeave}
    >
      {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
        const row = Math.floor(index / GRID_SIZE);
        const col = index % GRID_SIZE;
        const stored = board[index];
        const isWillClear = previewClearSet.has(index) && Boolean(previewTone);
        const effectiveTone = isWillClear ? previewTone : (stored?.tone ?? clearedTones[index]);

        const cellStyle = clearedSet.has(index)
          ? buildClearAnimationStyle(row, col, clearedRows, clearedCols)
          : undefined;

        return (
          <button
            key={`${row}-${col}`}
            className={[
              "board-cell",
              effectiveTone ? `is-filled tone-${effectiveTone}` : "",
              stored?.isFill ? "is-game-fill" : "",
              isWillClear ? "will-clear" : "",
              clearedSet.has(index) ? "was-cleared" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={cellStyle}
            type="button"
            aria-label={`Board cell ${row + 1}, ${col + 1}`}
            onClick={() => onCellClick(row, col)}
            disabled={!started}
          />
        );
      })}
    </div>
  );
}

function getSeededValue(seed, offset) {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function buildClearAnimationStyle(row, col, clearedRows, clearedCols) {
  const MAX_DELAY = 180;
  let dist = 0;
  if (clearedRows.has(row) && clearedCols.has(col)) {
    dist = Math.min(Math.abs(col - 3.5) / 3.5, Math.abs(row - 3.5) / 3.5);
  } else if (clearedRows.has(row)) {
    dist = Math.abs(col - 3.5) / 3.5;
  } else if (clearedCols.has(col)) {
    dist = Math.abs(row - 3.5) / 3.5;
  }

  const seed = row * 17 + col * 31 + 1;
  return {
    "--clear-delay": `${Math.round(dist * MAX_DELAY)}ms`,
    "--clear-duration": `${Math.round(540 + getSeededValue(seed, 1) * 120)}ms`,
    "--splash-rotation": `${Math.round(getSeededValue(seed, 2) * 360)}deg`,
    "--splash-scale-x": `${(0.9 + getSeededValue(seed, 3) * 0.45).toFixed(2)}`,
    "--splash-scale-y": `${(0.75 + getSeededValue(seed, 4) * 0.35).toFixed(2)}`,
  };
}

const DRAG_GHOST_LIFT_REM = 0.9;
const DROP_SNAP_SLOP_CELLS = 0.38;

function getGhostTransform(clientX, clientY) {
  return `translate3d(${clientX}px, ${clientY}px, 0) translate(-50%, calc(-100% - ${DRAG_GHOST_LIFT_REM}rem))`;
}

function getBoardCellMetrics(boardElement) {
  if (!boardElement) {
    return null;
  }

  const rect = boardElement.getBoundingClientRect();
  const styles = window.getComputedStyle(boardElement);
  const paddingLeft = Number.parseFloat(styles.paddingLeft || "0");
  const paddingTop = Number.parseFloat(styles.paddingTop || "0");
  const paddingX = paddingLeft * 2;
  const gap = Number.parseFloat(styles.gap || styles.rowGap || "0");
  const usableWidth = rect.width - paddingX;
  const cellSize = (usableWidth - gap * (GRID_SIZE - 1)) / GRID_SIZE;
  const step = cellSize + gap;
  const gridLeft = rect.left + paddingLeft;
  const gridTop = rect.top + paddingTop;
  const rootFontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize || "16"
  );

  return {
    rect,
    paddingLeft,
    paddingTop,
    gridLeft,
    gridTop,
    gridRight: gridLeft + cellSize * GRID_SIZE + gap * (GRID_SIZE - 1),
    gridBottom: gridTop + cellSize * GRID_SIZE + gap * (GRID_SIZE - 1),
    stepPx: step,
    gapPx: gap,
    cellSizePx: cellSize,
    rootFontSize,
    cellSizeRem: cellSize / rootFontSize,
    gapRem: gap / rootFontSize,
  };
}

function getGhostBounds(metrics, piece, clientX, clientY) {
  const pieceWidthPx =
    piece.bounds.width * metrics.cellSizePx + Math.max(0, piece.bounds.width - 1) * metrics.gapPx;
  const pieceHeightPx =
    piece.bounds.height * metrics.cellSizePx + Math.max(0, piece.bounds.height - 1) * metrics.gapPx;
  const liftPx = DRAG_GHOST_LIFT_REM * metrics.rootFontSize;
  const left = clientX - pieceWidthPx / 2;
  const top = clientY - pieceHeightPx - liftPx;

  return {
    left,
    top,
    right: left + pieceWidthPx,
    bottom: top + pieceHeightPx,
  };
}

function getSnappedPlacement(metrics, piece, clientX, clientY) {
  const ghostBounds = getGhostBounds(metrics, piece, clientX, clientY);
  const rawCol = Math.round((ghostBounds.left - metrics.gridLeft) / metrics.stepPx);
  const rawRow = Math.round((ghostBounds.top - metrics.gridTop) / metrics.stepPx);

  return {
    ghostBounds,
    col: Math.max(0, Math.min(GRID_SIZE - piece.bounds.width, rawCol)),
    row: Math.max(0, Math.min(GRID_SIZE - piece.bounds.height, rawRow)),
  };
}

export default function App() {
  const [game, setGame] = useState(() => createGameState(loadBestScore()));
  const [drag, setDrag] = useState(null);
  const [soundEnabled, setSoundEnabledState] = useState(() => isSoundEnabled());
  const [started, setStarted] = useState(false);
  const [gameOverPhase, setGameOverPhase] = useState(null); // null | 'filling' | 'overlay'
  const [fillCells, setFillCells] = useState([]);
  const [isNewBest, setIsNewBest] = useState(false);
  const boardRef = useRef(null);
  const dragGhostRef = useRef(null);
  const dragPointerRef = useRef({ x: 0, y: 0 });
  const pickupSoundPlayedRef = useRef(false);
  const previewSoundRef = useRef({ key: null, at: 0 });
  const fillIntervalRef = useRef(null);
  const prevBestScoreRef = useRef(game.bestScore);

  useEffect(() => {
    document.body.classList.toggle("is-dragging", drag !== null);

    return () => {
      document.body.classList.remove("is-dragging");
    };
  }, [drag]);

  useEffect(() => {
    if (game.bestScore > 0) {
      saveBestScore(game.bestScore);
    }
  }, [game.bestScore]);

  useEffect(() => {
    if (!game.gameOver) {
      return;
    }

    setDrag(null);
    setGame((current) => {
      if (current.preview === null && current.selectedPieceId === null) {
        return current;
      }
      return { ...current, preview: null, selectedPieceId: null };
    });

    const newBest = game.score > prevBestScoreRef.current;
    setIsNewBest(newBest);

    const TONES = ['coral', 'gold', 'mint', 'sky', 'orchid'];
    const emptyCells = game.board
      .map((cell, i) => (cell ? null : i))
      .filter((i) => i !== null)
      .sort(() => Math.random() - 0.5);

    setGameOverPhase('filling');
    setFillCells([]);

    let i = 0;
    const BATCH = 4;

    fillIntervalRef.current = setInterval(() => {
      const batch = emptyCells.slice(i, i + BATCH).map((index) => ({
        index,
        tone: TONES[Math.floor(Math.random() * TONES.length)],
      }));
      setFillCells((prev) => [...prev, ...batch]);
      playFillCellSound();
      i += BATCH;
      if (i >= emptyCells.length) {
        clearInterval(fillIntervalRef.current);
        fillIntervalRef.current = null;
        setTimeout(() => setGameOverPhase('overlay'), 350);
      }
    }, 35);

    return () => {
      if (fillIntervalRef.current) {
        clearInterval(fillIntervalRef.current);
        fillIntervalRef.current = null;
      }
    };
  }, [game.gameOver]);

  useEffect(() => {
    if (game.cleared.length === 0) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setGame((current) => clearClearedCells(current));
    }, 480);

    return () => window.clearTimeout(timer);
  }, [game.cleared]);

  const updatePreviewFromPoint = useEffectEvent((clientX, clientY, activeDrag = null) => {
    if (!started || game.gameOver) {
      return;
    }

    const pieceId = activeDrag?.pieceId ?? game.selectedPieceId;
    const piece = findPiece(game.tray, pieceId);
    const boardElement = boardRef.current;

    if (!piece || !boardElement) {
      return;
    }

    const metrics = getBoardCellMetrics(boardElement);

    if (!metrics) {
      return;
    }

    const { ghostBounds, row, col } = getSnappedPlacement(metrics, piece, clientX, clientY);
    const slopPx = metrics.stepPx * DROP_SNAP_SLOP_CELLS;

    if (
      ghostBounds.right < metrics.gridLeft - slopPx ||
      ghostBounds.left > metrics.gridRight + slopPx ||
      ghostBounds.bottom < metrics.gridTop - slopPx ||
      ghostBounds.top > metrics.gridBottom + slopPx
    ) {
      previewSoundRef.current.key = null;
      startTransition(() => {
        setGame((current) => clearPreview(current));
      });
      return;
    }

    const preview = buildPreview(game.board, piece, row, col);
    const previewKey = `${preview.pieceId}:${preview.row}:${preview.col}:${preview.valid ? 1 : 0}`;
    const now = performance.now();

    if (
      previewSoundRef.current.key !== previewKey &&
      now - previewSoundRef.current.at > 26
    ) {
      playPreviewMoveSound();
      previewSoundRef.current = { key: previewKey, at: now };
    }

    startTransition(() => {
      setGame((current) => setPreview(current, preview));
    });
  });

  const handleWindowPointerMove = useEffectEvent((event) => {
    if (drag && !pickupSoundPlayedRef.current) {
      primeSound();
      playPickupSound();
      pickupSoundPlayedRef.current = true;
    }

    if (drag) {
      dragPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
      };

      if (dragGhostRef.current) {
        dragGhostRef.current.style.transform = getGhostTransform(event.clientX, event.clientY);
      }

      updatePreviewFromPoint(event.clientX, event.clientY, drag);
    }
  });

  const handleWindowPointerUp = useEffectEvent((event) => {
    if (!drag) {
      return;
    }

    pickupSoundPlayedRef.current = false;
    previewSoundRef.current.key = null;
    const pieceId = drag.pieceId;
    const preview = game.preview;
    setDrag(null);

    if (preview?.valid && preview.pieceId === pieceId) {
      const nextGame = applyPlacement(game, pieceId, preview.row, preview.col);
      primeSound();
      playPlaceSound();

      if (nextGame.cleared.length > 0) {
        window.setTimeout(() => {
          playClearSound();
        }, 50);
      }

      setGame(nextGame);
      return;
    }

    setGame((current) => clearPreview(current));
  });

  useEffect(() => {
    if (!drag) {
      return undefined;
    }

    function onPointerMove(event) {
      handleWindowPointerMove(event);
    }

    function onPointerUp(event) {
      handleWindowPointerUp(event);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [drag, handleWindowPointerMove, handleWindowPointerUp]);

  function handleStartGame() {
    prevBestScoreRef.current = game.bestScore;
    setStarted(true);

    if (soundEnabled) {
      unlockAndTestSound();
    }
  }

  function handleRestart() {
    if (fillIntervalRef.current) {
      clearInterval(fillIntervalRef.current);
      fillIntervalRef.current = null;
    }
    prevBestScoreRef.current = game.bestScore;
    setGame(createGameState(game.bestScore));
    setGameOverPhase(null);
    setFillCells([]);
    setIsNewBest(false);
  }

  function handleToggleSound() {
    const nextEnabled = !soundEnabled;
    setSoundEnabled(nextEnabled);
    setSoundEnabledState(nextEnabled);

    if (nextEnabled) {
      unlockAndTestSound();
    }
  }

  function handleSelectPiece(pieceId) {
    if (!started || drag) {
      return;
    }

    primeSound();
    playPickupSound();
    setGame((current) => togglePieceSelection(current, pieceId));
  }

  function handleStartDrag(piece, event) {
    if (!started || game.gameOver) {
      return;
    }

    event.preventDefault();
    pickupSoundPlayedRef.current = true;
    primeSound();
    playPickupSound();

    setGame((current) => ({
      ...current,
      selectedPieceId: piece.id,
    }));

    dragPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
    };

    const nextDrag = {
      pieceId: piece.id,
    };

    previewSoundRef.current.key = null;
    setDrag(nextDrag);
    updatePreviewFromPoint(event.clientX, event.clientY, nextDrag);
  }

  function handleBoardMove(event) {
    if (!started || !game.selectedPieceId || drag || game.gameOver) {
      return;
    }

    updatePreviewFromPoint(event.clientX, event.clientY);
  }

  function handleBoardLeave() {
    if (!started || drag) {
      return;
    }

    previewSoundRef.current.key = null;
    setGame((current) => clearPreview(current));
  }

  function handleCellClick(row, col) {
    if (!started || !game.selectedPieceId || game.gameOver) {
      return;
    }

    const nextGame = applyPlacement(game, game.selectedPieceId, row, col);

    if (nextGame !== game) {
      primeSound();
      playPlaceSound();

      if (nextGame.cleared.length > 0) {
        window.setTimeout(() => {
          playClearSound();
        }, 50);
      }
    }

    setGame(nextGame);
  }

  const clearedSet = new Set(game.cleared);

  let displayBoard = game.board;
  if (fillCells.length > 0) {
    displayBoard = [...game.board];
    for (const { index, tone } of fillCells) {
      if (!displayBoard[index]) {
        displayBoard[index] = { tone, groupId: -1, isFill: true };
      }
    }
  }

  // Derive which cells would be cleared at the current valid preview position
  let previewClearSet = new Set();
  let previewTone = null;
  if (game.preview?.valid) {
    const previewPiece = findPiece(game.tray, game.preview.pieceId);
    if (previewPiece) {
      const simBoard = [...game.board];
      for (const [dx, dy] of previewPiece.shape.cells) {
        simBoard[toIndex(game.preview.row + dy, game.preview.col + dx)] = {
          tone: previewPiece.tone,
          groupId: previewPiece.id,
        };
      }
      previewClearSet = findClears(simBoard);
      if (previewClearSet.size > 0) {
        previewTone = previewPiece.tone;
      }
    }
  }

  const dragPiece = drag ? findPiece(game.tray, drag.pieceId) : null;
  const showDragGhost = Boolean(dragPiece);
  const dragGhostMetrics = dragPiece ? getBoardCellMetrics(boardRef.current) : null;
  const dragGhostStyle = {
    transform: getGhostTransform(dragPointerRef.current.x, dragPointerRef.current.y),
  };

  return (
    <>
      <div className="app-shell">
        <header className="hero">
          <button
            className={`sound-icon-button hero-sound-button${soundEnabled ? " is-active" : ""}`}
            type="button"
            onClick={handleToggleSound}
            aria-label={soundEnabled ? "Mute sound" : "Enable sound"}
          >
            <SpeakerIcon on={soundEnabled} />
          </button>
          <h1>GridPop!</h1>
        </header>

        <main className="game-layout">
          <aside className="score-rail">
            <ScorePanel
              score={game.score}
              bestScore={game.bestScore}
              combo={game.combo}
            />
          </aside>

          <section className="playfield">
            <div className="board-container">
              <Board
                boardRef={boardRef}
                board={displayBoard}
                clearedSet={clearedSet}
                clearedTones={game.clearedTones}
                previewClearSet={previewClearSet}
                previewTone={previewTone}
                started={started}
                onBoardMove={handleBoardMove}
                onBoardLeave={handleBoardLeave}
                onCellClick={handleCellClick}
              />
              {!started ? (
                <div className="start-overlay" role="dialog" aria-modal="true" aria-label="Start game">
                  <button className="start-button" type="button" onClick={handleStartGame}>
                    Start Game
                  </button>
                </div>
              ) : null}
              {gameOverPhase === 'overlay' ? (
                <div
                  className={`start-overlay game-over-overlay${isNewBest ? ' is-new-best' : ''}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Game over"
                >
                  <div className="game-over-content">
                    {isNewBest && <p className="new-best-banner">✨ New Best! ✨</p>}
                    <p className="game-over-score">{game.score}</p>
                    <button className="start-button" type="button" onClick={handleRestart}>
                      Play Again
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="sidebar">
            <Tray
              tray={game.tray}
              selectedPieceId={game.selectedPieceId}
              gameOver={game.gameOver}
              started={started}
              onSelectPiece={handleSelectPiece}
              onStartDrag={handleStartDrag}
            />
          </aside>
        </main>
      </div>

      {showDragGhost ? (
        <div ref={dragGhostRef} className="drag-ghost" style={dragGhostStyle}>
          <PieceGrid
            piece={dragPiece}
            cellSizeOverride={dragGhostMetrics?.cellSizeRem ?? null}
            gapSizeOverride={dragGhostMetrics?.gapRem ?? null}
          />
        </div>
      ) : null}
    </>
  );
}
