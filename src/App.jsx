import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import {
  GRID_SIZE,
  loadRunHistory,
  recordRunScore,
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
import { hasSupabaseConfig, supabase } from "./supabase.js";

const OTP_LENGTH = 6;
const PROFILE_NAME_LIMIT = 22;
const EMAIL_LENGTH_LIMIT = 320;
const GLOBAL_LEADERBOARD_ENABLED = true;
const GLOBAL_LEADERBOARD_LIMIT = 10;
const PERSONAL_RECENT_RUN_LIMIT = 10;
const PERSONAL_TOP_RUN_LIMIT = 3;
const LEADERBOARD_CASCADE_STAGGER_MS = 55;
const CLIENT_VERSION = "gridpop-web-1";
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;

function normalizeEmail(value) {
  return value
    .normalize("NFKC")
    .replace(CONTROL_CHARS_PATTERN, "")
    .trim()
    .toLowerCase()
    .slice(0, EMAIL_LENGTH_LIMIT);
}

function normalizeOtp(value) {
  return value.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

function normalizeProfileName(value) {
  return value
    .normalize("NFKC")
    .replace(CONTROL_CHARS_PATTERN, "")
    .replace(ZERO_WIDTH_PATTERN, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, PROFILE_NAME_LIMIT);
}

function formatRunDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} at ${hh}:${min}`;
}

async function getFunctionErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }

  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();

      if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error.trim();
      }
    } catch {
      // Fall through to the generic message below.
    }
  }

  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return error.message || fallback;
  }

  return typeof error.message === "string" && error.message.trim() ? error.message.trim() : fallback;
}

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

function UserIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="7.2" r="2.3" />
      <path d="M5.8 14.5c1.1-1.8 2.7-2.7 4.2-2.7s3.1 0.9 4.2 2.7" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M2 16.5 L2 14 L1.5 7.5 L7 12 L10 4.5 L13 12 L18.5 7.5 L18 14 L18 16.5 Z" fill="#f5c518" />
      <rect x="1.5" y="14" width="17" height="2.8" rx="0.5" fill="#f5c518" />
      <circle cx="1.5" cy="7.5" r="1.2" fill="#f5c518" />
      <circle cx="10" cy="4.5" r="1.2" fill="#f5c518" />
      <circle cx="18.5" cy="7.5" r="1.2" fill="#f5c518" />
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

function MiniBoard({ grid }) {
  const cols = grid[0].length;
  return (
    <div className="mini-board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {grid.flat().map((tone, i) => (
        <div key={i} className={`mini-cell${tone ? ` mini-cell--${tone}` : ""}`} />
      ))}
    </div>
  );
}

function HowToPlayModal({ onClose }) {
  const placeGrid = [
    [null,    null,     null,     null   ],
    ["sky",   null,     null,     null   ],
    ["sky",   "coral",  null,     null   ],
    ["sky",   "coral",  "coral",  null   ],
  ];

  const clearGrid = [
    [null,    "mint",   null,     "sky"  ],
    ["coral", null,     "sky",    null   ],
    [null,    "gold",   null,     "orchid"],
    ["gold",  "gold",   "gold",   "gold" ],
  ];

  return (
    <div
      className="how-to-play-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="How to Play"
      onClick={onClose}
    >
      <div className="how-to-play-wrap" onClick={(event) => event.stopPropagation()}>
        <button className="leaderboard-close" type="button" onClick={onClose} aria-label="Close how to play">
          Close
        </button>
        <section className="how-to-play-modal">
          <div className="leaderboard-colour-strip" aria-hidden="true" />
          <h2>How to Play</h2>
          <div className="how-to-play-steps">
            <div className="how-to-play-step">
              <MiniBoard grid={placeGrid} />
              <div className="how-to-play-step-body">
                <strong className="how-to-play-step-title">Drop</strong>
                <p>Drag a shape from the tray onto the grid. Each individual piece of a shape scores points.</p>
                <p className="how-to-play-pts">10 pts per piece</p>
              </div>
            </div>
            <div className="how-to-play-step">
              <MiniBoard grid={clearGrid} />
              <div className="how-to-play-step-body">
                <strong className="how-to-play-step-title">Pop</strong>
                <p>Fill every cell in a row or column and the whole line pops. The more lines you pop at once, the bigger the score.</p>
                <p className="how-to-play-pts">120 pts per line popped</p>
              </div>
            </div>
            <div className="how-to-play-step">
              <div className="how-to-play-combo-badges" aria-hidden="true">
                <span className="how-to-play-badge">×1</span>
                <span className="how-to-play-badge">×2</span>
                <span className="how-to-play-badge how-to-play-badge--hot">×3</span>
              </div>
              <div className="how-to-play-step-body">
                <strong className="how-to-play-step-title">Combo</strong>
                <p>Clear lines on back-to-back placements to grow your combo multiplier.</p>
                <p className="how-to-play-pts">Each clear in a row adds ×1</p>
              </div>
            </div>
          </div>
          <p className="how-to-play-footer">
            The game ends when no piece in the tray can fit on the grid.
          </p>
        </section>
      </div>
    </div>
  );
}

function PlayerHandle({ displayName }) {
  if (!displayName) {
    return null;
  }

  return (
    <p className="player-handle" title={displayName}>
      <span className="player-handle-sparkle" aria-hidden="true">✨</span>
      <span className="player-handle-name">{displayName}</span>
      <span className="player-handle-sparkle" aria-hidden="true">✨</span>
    </p>
  );
}

function ProfileTrigger({ active, onClick }) {
  return (
    <button
      className={`profile-trigger${active ? " is-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-label={active ? "Close profile panel" : "Open profile panel"}
    >
      <UserIcon />
      <span>Profile</span>
    </button>
  );
}

function ScoreboardTrigger({ onClick }) {
  return (
    <button className="scoreboard-trigger" type="button" onClick={onClick}>
      Scoreboard
    </button>
  );
}

function LeaderboardModal({
  activeTab,
  globalEnabled,
  globalError,
  globalLoading,
  globalRuns,
  globalVisibleCount,
  personalError,
  personalLabel,
  personalLoading,
  personalRuns,
  personalTopRuns,
  personalVisibleCount,
  signedIn,
  onClose,
  onTabChange,
  open,
}) {
  if (!open) {
    return null;
  }

  const bestPersonalRun = personalTopRuns[0] ?? null;
  const globalTopRun = globalRuns[0] ?? null;
  const globalRemainingRuns = globalRuns.slice(1);

  return (
    <div
      className="leaderboard-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Scoreboard"
      onClick={onClose}
    >
      <div className="leaderboard-modal-wrap" onClick={(event) => event.stopPropagation()}>
        <button className="leaderboard-close" type="button" onClick={onClose} aria-label="Close scoreboard">
          Close
        </button>
        <section className="leaderboard-modal">
          <div className="leaderboard-colour-strip" aria-hidden="true" />
          <h2>Scoreboard</h2>

        <div className="leaderboard-tabs" role="tablist" aria-label="Scoreboard sections">
          <button
            className={`leaderboard-tab${activeTab === "personal" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "personal"}
            onClick={() => onTabChange("personal")}
          >
            {personalLabel}
          </button>
          {globalEnabled ? (
            <button
              className={`leaderboard-tab${activeTab === "global" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === "global"}
              onClick={() => onTabChange("global")}
            >
              Global Top 10
            </button>
          ) : null}
        </div>

        {globalEnabled && activeTab === "global" ? (
          <p className="leaderboard-disclaimer">
            Only runs started whilst signed in count towards the global board.
          </p>
        ) : null}

        {!globalEnabled || activeTab === "personal" ? (
          <div key="personal-panel" className="leaderboard-panel">
            <div className="leaderboard-list-wrap">
              <p className="section-label">Best Runs</p>
              {bestPersonalRun ? (
                <div className="leaderboard-podium" role="list" aria-label={`${personalLabel} best runs`}>
                  {personalTopRuns.map((run, index) => (
                    <div
                      key={`${run.id ?? run.createdAt}-${run.score}-top-${index}`}
                      className={`leaderboard-podium-card${index === 0 ? " is-best" : ""}`}
                      role="listitem"
                    >
                      <span className="leaderboard-podium-rank">
                        {index + 1}
                        {index === 0 ? "st" : index === 1 ? "nd" : "rd"}
                      </span>
                      <strong className="leaderboard-podium-score">{run.score}</strong>
                      <span className="leaderboard-meta">{formatRunDate(run.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="leaderboard-empty">
                  {personalLabel === "My Runs" ? "No account runs yet." : "No device runs yet."}
                </p>
              )}
            </div>

            <div className="leaderboard-list-wrap">
              <p className="section-label">Recent Runs</p>
              {personalLoading ? <p className="leaderboard-empty">Loading {personalLabel.toLowerCase()}...</p> : null}
              {!personalLoading && personalError ? <p className="leaderboard-empty">{personalError}</p> : null}
              {!personalLoading && !personalError && personalRuns.length > 0 ? (
                <ol className="leaderboard-list leaderboard-list-local">
                  {personalRuns.map((run, index) =>
                    index < personalVisibleCount ? (
                      <li key={`personal-visible-${run.id ?? run.createdAt}-${run.score}-${index}`} className="leaderboard-row leaderboard-row--pop">
                        <span className="leaderboard-rank">{String(index + 1).padStart(2, "0")}</span>
                        <strong className="leaderboard-score">{run.score}</strong>
                        <span className="leaderboard-meta leaderboard-date">{formatRunDate(run.createdAt)}</span>
                      </li>
                    ) : (
                      <li key={`personal-ghost-${run.id ?? run.createdAt}-${run.score}-${index}`} className="leaderboard-row leaderboard-row--skeleton" aria-hidden="true">
                        <span className="leaderboard-rank">&nbsp;</span>
                        <span className="leaderboard-score">&nbsp;</span>
                        <span className="leaderboard-meta leaderboard-date">&nbsp;</span>
                      </li>
                    )
                  )}
                </ol>
              ) : null}
              {!personalLoading && !personalError && personalRuns.length === 0 ? (
                <p className="leaderboard-empty">
                  {personalLabel === "My Runs"
                    ? "Finish a signed-in run and it will show up here."
                    : "Finish a run and it will show up here."}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div key="global-panel" className="leaderboard-panel">
            <div className="leaderboard-best leaderboard-best--global">
              {globalLoading ? (
                <div className="leaderboard-hero leaderboard-hero--skeleton" aria-hidden="true">
                  <span className="leaderboard-hero-rank">&nbsp;</span>
                  <strong className="leaderboard-hero-score">&nbsp;</strong>
                  <span className="leaderboard-hero-name">&nbsp;</span>
                </div>
              ) : null}
              {!globalLoading && globalTopRun ? (
                <div className="leaderboard-hero">
                  <span className="leaderboard-hero-rank" aria-label="First place">
                    <CrownIcon />
                  </span>
                  <strong className="leaderboard-best-score">{globalTopRun.score}</strong>
                  <span className="leaderboard-hero-name">{globalTopRun.displayName}</span>
                </div>
              ) : null}
              {!globalLoading && !globalError && !globalTopRun ? (
                <p className="leaderboard-empty">No global runs yet.</p>
              ) : null}
            </div>

            <div className="leaderboard-list-wrap leaderboard-list-wrap--global">
              {globalLoading ? (
                <ol className="leaderboard-list leaderboard-list-global leaderboard-list--loading">
                  {Array.from({ length: Math.max(0, GLOBAL_LEADERBOARD_LIMIT - 1) }, (_, i) => (
                    <li key={i} className="leaderboard-row leaderboard-row--skeleton" aria-hidden="true">
                      <span className="leaderboard-rank">&nbsp;</span>
                      <span className="leaderboard-score">&nbsp;</span>
                      <span className="leaderboard-name">&nbsp;</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {!globalLoading && globalError ? <p className="leaderboard-empty">{globalError}</p> : null}
              {!globalLoading && !globalError && globalRemainingRuns.length > 0 ? (
                <ol className="leaderboard-list leaderboard-list-global">
                  {globalRemainingRuns.map((run, index) =>
                    index + 2 <= globalVisibleCount ? (
                      <li key={`visible-${run.id}-${run.createdAt}-${index}`} className="leaderboard-row leaderboard-row--pop">
                        <span className="leaderboard-rank">{String(index + 2).padStart(2, "0")}</span>
                        <strong className="leaderboard-score">{run.score}</strong>
                        <span className="leaderboard-name">{run.displayName}</span>
                      </li>
                    ) : (
                      <li key={`ghost-${run.id}-${run.createdAt}-${index}`} className="leaderboard-row leaderboard-row--skeleton" aria-hidden="true">
                        <span className="leaderboard-rank">&nbsp;</span>
                        <span className="leaderboard-score">&nbsp;</span>
                        <span className="leaderboard-name">&nbsp;</span>
                      </li>
                    )
                  )}
                </ol>
              ) : null}
            </div>
          </div>
        )}
        </section>
      </div>
    </div>
  );
}

function AuthPanel({
  authCode,
  authEmail,
  authError,
  authMessage,
  authPending,
  authReady,
  displayNameDraft,
  editingProfile,
  hasConfig,
  onCodeChange,
  onCancelEditProfile,
  onDisplayNameChange,
  onEditProfile,
  onRequestCode,
  onResetOtp,
  onSaveProfile,
  onSignOut,
  onVerifyCode,
  otpSentTo,
  profile,
  profilePending,
  session,
}) {
  return (
    <section className="auth-panel" aria-label="Player account">
      <p className="section-label">Your Profile</p>
      {!hasConfig ? (
        <p className="auth-copy">Supabase is not configured yet.</p>
      ) : null}
      {hasConfig && !authReady ? (
        <p className="auth-copy">Connecting to player services...</p>
      ) : null}
      {hasConfig && authReady && !session && !otpSentTo ? (
        <form className="auth-form" onSubmit={onRequestCode}>
          <p className="auth-copy">Sign in to create your player profile.</p>
          <label className="auth-field">
            <span className="auth-label">Email</span>
            <input
              className="auth-input"
              type="email"
              value={authEmail}
              onChange={(event) => onDisplayNameChange("email", event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              maxLength={EMAIL_LENGTH_LIMIT}
              required
            />
          </label>
          <button className="auth-button" type="submit" disabled={authPending}>
            {authPending ? "Sending..." : "Send Code"}
          </button>
        </form>
      ) : null}
      {hasConfig && authReady && !session && otpSentTo ? (
        <form className="auth-form" onSubmit={onVerifyCode}>
          <p className="auth-copy">Enter the {OTP_LENGTH}-digit code sent to {otpSentTo}.</p>
          <label className="auth-field">
            <span className="auth-label">Code</span>
            <input
              className="auth-input auth-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={authCode}
              onChange={(event) => onCodeChange(normalizeOtp(event.target.value))}
              placeholder={"0".repeat(OTP_LENGTH)}
              maxLength={OTP_LENGTH}
              required
            />
          </label>
          <div className="auth-actions">
            <button className="auth-button" type="submit" disabled={authPending || authCode.length !== OTP_LENGTH}>
              {authPending ? "Checking..." : "Verify Code"}
            </button>
            <button className="auth-secondary-button" type="button" onClick={onResetOtp} disabled={authPending}>
              Change Email
            </button>
          </div>
        </form>
      ) : null}
      {hasConfig && authReady && session ? (
        <div className="auth-form">
          <div className="auth-identity">
            <strong>{profile?.display_name ?? "Choose a display name"}</strong>
            <span>{session.user.email}</span>
          </div>
          {profile?.display_name && !editingProfile ? (
            <>
              <div className="auth-actions">
                <button className="auth-secondary-button" type="button" onClick={onEditProfile} disabled={profilePending}>
                  Edit Name
                </button>
                <button className="auth-secondary-button" type="button" onClick={onSignOut} disabled={profilePending}>
                  Sign Out
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="auth-copy">
                {profile?.display_name
                  ? "Update your public display name."
                  : "Set a public display name for your player profile."}
              </p>
              <form className="auth-form auth-form-inline" onSubmit={onSaveProfile}>
                <label className="auth-field">
                  <span className="auth-label">Display Name</span>
                  <input
                    className="auth-input"
                    type="text"
                    value={displayNameDraft}
                    onChange={(event) => onDisplayNameChange("profile", event.target.value)}
                    placeholder="Grid wizard"
                    maxLength={PROFILE_NAME_LIMIT}
                    required
                  />
                </label>
                <button className="auth-button" type="submit" disabled={profilePending}>
                  {profilePending ? "Saving..." : "Save Name"}
                </button>
                {profile?.display_name ? (
                  <button
                    className="auth-secondary-button"
                    type="button"
                    onClick={onCancelEditProfile}
                    disabled={profilePending}
                  >
                    Cancel
                  </button>
                ) : null}
              </form>
              <button className="auth-secondary-button" type="button" onClick={onSignOut} disabled={profilePending}>
                Sign Out
              </button>
            </>
          )}
        </div>
      ) : null}
      {authMessage ? <p className="auth-status">{authMessage}</p> : null}
      {authError ? <p className="auth-error">{authError}</p> : null}
    </section>
  );
}

function Tray({ tray, selectedPieceId, gameOver, started, onSelectPiece, onStartDrag }) {
  return (
    <div className="tray" aria-label="Available shapes">
      {Array.from({ length: TRAY_SIZE }, (_, index) => {
        const piece = started ? tray[index] : null;

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
  const [authReady, setAuthReady] = useState(() => !hasSupabaseConfig);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [otpSentTo, setOtpSentTo] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [profilePending, setProfilePending] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [localRuns, setLocalRuns] = useState(() => loadRunHistory());
  const [accountRecentRuns, setAccountRecentRuns] = useState([]);
  const [accountTopRuns, setAccountTopRuns] = useState([]);
  const [accountRunsLoading, setAccountRunsLoading] = useState(false);
  const [accountRunsError, setAccountRunsError] = useState("");
  const [personalVisibleCount, setPersonalVisibleCount] = useState(0);
  const [globalRuns, setGlobalRuns] = useState([]);
  const [globalVisibleCount, setGlobalVisibleCount] = useState(0);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState("personal");
  const [showDesktopAuthPanel, setShowDesktopAuthPanel] = useState(false);
  const [showMobileAuthPanel, setShowMobileAuthPanel] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [activeVerifiedRun, setActiveVerifiedRun] = useState(null);
  const [startPending, setStartPending] = useState(false);
  const [runSubmitting, setRunSubmitting] = useState(false);
  const [runSubmissionError, setRunSubmissionError] = useState("");
  const accountRunsFetchInFlightRef = useRef(false);
  const globalFetchInFlightRef = useRef(false);
  const runSubmissionInFlightRef = useRef(false);
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

  const loadAccountRuns = useEffectEvent(async () => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !hasSupabaseConfig || !session?.user?.id) {
      setAccountRecentRuns([]);
      setAccountTopRuns([]);
      setAccountRunsError("");
      return;
    }

    if (accountRunsFetchInFlightRef.current) {
      return;
    }

    accountRunsFetchInFlightRef.current = true;
    setAccountRunsLoading(true);
    setAccountRunsError("");

    const [recentResult, topResult] = await Promise.all([
      supabase
        .from("scores")
        .select("id, score, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(PERSONAL_RECENT_RUN_LIMIT),
      supabase
        .from("scores")
        .select("id, score, created_at")
        .eq("user_id", session.user.id)
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(PERSONAL_TOP_RUN_LIMIT),
    ]);

    setAccountRunsLoading(false);
    accountRunsFetchInFlightRef.current = false;

    if (recentResult.error || topResult.error) {
      setAccountRecentRuns([]);
      setAccountTopRuns([]);
      setAccountRunsError("Could not load your runs right now.");
      return;
    }

    setAccountRecentRuns(
      (recentResult.data ?? []).map((run) => ({
        id: String(run.id),
        score: run.score,
        createdAt: run.created_at,
      }))
    );
    setAccountTopRuns(
      (topResult.data ?? []).map((run) => ({
        id: String(run.id),
        score: run.score,
        createdAt: run.created_at,
      }))
    );
  });

  const loadGlobalLeaderboard = useEffectEvent(async () => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !hasSupabaseConfig) {
      setGlobalError("Global leaderboard is not configured.");
      setGlobalRuns([]);
      return;
    }

    if (globalFetchInFlightRef.current) {
      return;
    }

    globalFetchInFlightRef.current = true;
    setGlobalLoading(true);
    setGlobalError("");

    const { data, error } = await supabase
      .from("scores")
      .select("id, score, created_at, profiles(display_name)")
      .not("run_id", "is", null)
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(GLOBAL_LEADERBOARD_LIMIT);

    setGlobalLoading(false);
    globalFetchInFlightRef.current = false;

    if (error) {
      if (error.message?.toLowerCase().includes("scores")) {
        setGlobalError("Run supabase/scores.sql to enable the global board.");
      } else {
        setGlobalError("Could not load the global leaderboard right now.");
      }
      setGlobalRuns([]);
      return;
    }

    const nextRuns = (data ?? []).map((run) => {
      const profileRecord = Array.isArray(run.profiles) ? run.profiles[0] : run.profiles;

      return {
        id: run.id,
        score: run.score,
        createdAt: run.created_at,
        displayName: normalizeProfileName(profileRecord?.display_name ?? "Player"),
      };
    });

    setGlobalRuns(nextRuns);
  });

  const autoSubmitGuestRun = useEffectEvent((score) => {
    if (!session || activeVerifiedRun || !hasSupabaseConfig) {
      return;
    }

    setRunSubmitting(true);

    supabase.functions
      .invoke("merge-local-scores", {
        body: { scores: [{ score, createdAt: new Date().toISOString() }] },
      })
      .then(({ error }) => {
        setRunSubmitting(false);
        if (!error) loadAccountRuns();
      });
  });

  useEffect(() => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !leaderboardOpen || leaderboardTab !== "global") {
      return;
    }

    loadGlobalLeaderboard();
  }, [leaderboardOpen, leaderboardTab]);

  useEffect(() => {
    if (!leaderboardOpen || leaderboardTab !== "global") {
      setGlobalVisibleCount(0);
      return;
    }

    if (globalLoading) {
      setGlobalVisibleCount(0);
      return;
    }

    if (globalError || globalRuns.length === 0) {
      setGlobalVisibleCount(globalRuns.length);
      return;
    }

    setGlobalVisibleCount(1);

    if (soundEnabled) {
      playFillCellSound();
    }

    const timers = globalRuns.slice(1).map((_, index) =>
      setTimeout(() => {
        if (soundEnabled) {
          playFillCellSound();
        }

        startTransition(() => {
          setGlobalVisibleCount(index + 2);
        });
      }, (index + 1) * LEADERBOARD_CASCADE_STAGGER_MS)
    );

    return () => timers.forEach(clearTimeout);
  }, [globalError, globalLoading, globalRuns, leaderboardOpen, leaderboardTab, soundEnabled]);

  useEffect(() => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !hasSupabaseConfig || !session?.user?.id) {
      setAccountRecentRuns([]);
      setAccountTopRuns([]);
      setAccountRunsError("");
      setAccountRunsLoading(false);
      return;
    }

    loadAccountRuns();
  }, [session?.user?.id]);


  useEffect(() => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !hasSupabaseConfig || !game.gameOver || !activeVerifiedRun?.id) {
      return;
    }

    if (runSubmissionInFlightRef.current) {
      return;
    }

    runSubmissionInFlightRef.current = true;
    setRunSubmitting(true);
    setRunSubmissionError("");

    supabase.functions
      .invoke("finish-run", {
        body: {
          runId: activeVerifiedRun.id,
          moves: activeVerifiedRun.moves,
        },
      })
      .then(async ({ error }) => {
        runSubmissionInFlightRef.current = false;
        setRunSubmitting(false);
        setActiveVerifiedRun(null);

        if (error) {
          setRunSubmissionError(await getFunctionErrorMessage(error, "Could not submit this score."));
          return;
        }

        loadAccountRuns();

        if (leaderboardOpen && leaderboardTab === "global") {
          loadGlobalLeaderboard();
        }
      });
  }, [
    activeVerifiedRun,
    game.gameOver,
    leaderboardOpen,
    leaderboardTab,
  ]);

  useEffect(() => {
    if (!leaderboardOpen) {
      return undefined;
    }

    function handleWindowKeyDown(event) {
      if (event.key === "Escape") {
        setLeaderboardOpen(false);
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [leaderboardOpen]);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      return undefined;
    }

    let alive = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) {
        return;
      }

      if (error) {
        setAuthError(error.message);
      } else {
        setSession(data.session);
      }

      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) {
        return;
      }

      setSession(nextSession);
      setAuthReady(true);
      setAuthPending(false);

      if (!nextSession) {
        setProfile(null);
        setDisplayNameDraft("");
        setEditingProfile(false);
        setShowDesktopAuthPanel(false);
        setAccountRecentRuns([]);
        setAccountTopRuns([]);
        setActiveVerifiedRun(null);
        setAuthCode("");
        setOtpSentTo("");
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig || !session?.user?.id) {
      setProfile(null);
      setDisplayNameDraft("");
      setEditingProfile(false);
      return;
    }

    let alive = true;

    async function loadProfile() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!alive) {
        return;
      }

      if (error) {
        setAuthError(error.message);
        return;
      }

      const nextProfile = data
        ? {
            ...data,
            display_name: normalizeProfileName(data.display_name ?? ""),
          }
        : null;

      setProfile(nextProfile);
      setDisplayNameDraft(nextProfile?.display_name ?? "");
      setEditingProfile(false);
    }

    loadProfile();

    return () => {
      alive = false;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!game.gameOver) {
      return;
    }

    setLocalRuns(recordRunScore(game.score));
    autoSubmitGuestRun(game.score);

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

  const rankedReady = Boolean(
    GLOBAL_LEADERBOARD_ENABLED && hasSupabaseConfig && session?.user?.id && profile?.display_name
  );

  function recordVerifiedMove(pieceId, row, col) {
    setActiveVerifiedRun((current) =>
      current
        ? {
            ...current,
            moves: [...current.moves, { pieceId, row, col }],
          }
        : current
    );
  }

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

      if (nextGame !== game) {
        recordVerifiedMove(pieceId, preview.row, preview.col);
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

  async function beginNextGame() {
    prevBestScoreRef.current = displayedBestScore;
    setGameOverPhase(null);
    setFillCells([]);
    setIsNewBest(false);
    setRunSubmitting(false);
    setRunSubmissionError("");
    setActiveVerifiedRun(null);
    setStarted(false);
    setGame(createGameState(displayedBestScore));

    if (rankedReady) {
      setStartPending(true);

      const { data, error } = await supabase.functions.invoke("start-run", {
        body: {
          clientVersion: CLIENT_VERSION,
        },
      });

      setStartPending(false);

      if (!error && data?.runId && data?.seed) {
        setGame(createGameState(displayedBestScore, { seed: data.seed }));
        setActiveVerifiedRun({
          id: data.runId,
          moves: [],
        });
        setStarted(true);

        if (soundEnabled) {
          unlockAndTestSound();
        }

        return;
      }

      setAuthError(await getFunctionErrorMessage(error, "Could not start your run right now. This run will stay local."));
    }

    setGame(createGameState(displayedBestScore));
    setStarted(true);

    if (soundEnabled) {
      unlockAndTestSound();
    }
  }

  function handleStartGame() {
    beginNextGame();
  }

  function handleRestart() {
    if (fillIntervalRef.current) {
      clearInterval(fillIntervalRef.current);
      fillIntervalRef.current = null;
    }
    beginNextGame();
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

      recordVerifiedMove(game.selectedPieceId, row, col);
    }

    setGame(nextGame);
  }

  async function handleRequestCode(event) {
    event.preventDefault();

    if (!hasSupabaseConfig) {
      return;
    }

    const normalizedEmail = normalizeEmail(authEmail);

    if (!normalizedEmail) {
      setAuthError("Enter an email address first.");
      return;
    }

    setAuthPending(true);
    setAuthError("");
    setAuthMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: true,
      },
    });

    setAuthPending(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setAuthEmail(normalizedEmail);
    setOtpSentTo(normalizedEmail);
    setAuthCode("");
    setAuthMessage("Check your inbox for the GridPop! sign-in code.");
  }

  async function handleVerifyCode(event) {
    event.preventDefault();

    if (!hasSupabaseConfig) {
      return;
    }

    const normalizedCode = normalizeOtp(authCode);

    if (normalizedCode.length !== OTP_LENGTH) {
      setAuthError(`Enter the full ${OTP_LENGTH}-digit code.`);
      return;
    }

    setAuthPending(true);
    setAuthError("");
    setAuthMessage("");

    const { error } = await supabase.auth.verifyOtp({
      email: otpSentTo,
      token: normalizedCode,
      type: "email",
    });

    setAuthPending(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setAuthCode("");
    setOtpSentTo("");
    setAuthMessage("");
  }

  function handleResetOtp() {
    setOtpSentTo("");
    setAuthCode("");
    setAuthMessage("");
    setAuthError("");
  }

  async function handleSaveProfile(event) {
    event.preventDefault();

    if (!hasSupabaseConfig || !session?.user?.id) {
      return;
    }

    const nextDisplayName = normalizeProfileName(displayNameDraft);

    if (!nextDisplayName) {
      setAuthError("Pick a display name first.");
      return;
    }

    setProfilePending(true);
    setAuthError("");
    setAuthMessage("");

    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: session.user.id,
          display_name: nextDisplayName,
        },
        { onConflict: "id" }
      )
      .select("id, display_name")
      .single();

    setProfilePending(false);

    if (error) {
      if (error.code === "23505") {
        setAuthError("That display name is already taken.");
        return;
      }

      setAuthError(error.message);
      return;
    }

    const nextProfile = {
      ...data,
      display_name: normalizeProfileName(data.display_name ?? ""),
    };

    setProfile(nextProfile);
    setDisplayNameDraft(nextProfile.display_name);
    setEditingProfile(false);
    setAuthMessage("Display name saved.");
    setShowDesktopAuthPanel(false);
    setShowMobileAuthPanel(false);
  }

  async function handleSignOut() {
    if (!hasSupabaseConfig) {
      return;
    }

    setAuthError("");
    setAuthMessage("");

    const { error } = await supabase.auth.signOut();

    if (error) {
      setAuthError(error.message);
      return;
    }

    setActiveVerifiedRun(null);
    setAuthMessage("Signed out.");
  }

  function handleAuthFieldChange(field, value) {
    setAuthError("");
    setAuthMessage("");

    if (field === "email") {
      setAuthEmail(normalizeEmail(value));
      return;
    }

    setDisplayNameDraft(normalizeProfileName(value));
  }

  function handleToggleMobileAuthPanel() {
    setShowMobileAuthPanel((current) => !current);
  }

  function handleCloseMobileAuthPanel() {
    setShowMobileAuthPanel(false);
  }

  function handleToggleDesktopAuthPanel() {
    setShowDesktopAuthPanel((current) => !current);
  }

  function handleOpenLeaderboard(tab = "personal") {
    if (tab === "global" && soundEnabled) {
      primeSound();
    }
    if (tab === "personal") {
      setPersonalVisibleCount(0);
    }
    if (tab === "global") {
      setGlobalVisibleCount(0);
    }
    setLeaderboardTab(tab);
    setLeaderboardOpen(true);
    setShowDesktopAuthPanel(false);
    setShowMobileAuthPanel(false);
  }

  function handleLeaderboardTabChange(nextTab) {
    if (nextTab === leaderboardTab) {
      return;
    }

    if (soundEnabled) {
      primeSound();
      playPickupSound();
    }

    if (nextTab === "personal") {
      setPersonalVisibleCount(0);
    }
    if (nextTab === "global") {
      setGlobalVisibleCount(0);
    }

    setLeaderboardTab(nextTab);
  }

  function handleCloseLeaderboard() {
    setLeaderboardOpen(false);
  }

  function handleEditProfile() {
    setDisplayNameDraft(profile?.display_name ?? "");
    setEditingProfile(true);
    setAuthError("");
    setAuthMessage("");
  }

  function handleCancelEditProfile() {
    setDisplayNameDraft(profile?.display_name ?? "");
    setEditingProfile(false);
    setAuthError("");
    setAuthMessage("");
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
  const accountBestScore = accountTopRuns[0]?.score ?? 0;
  const localTopRuns = [...localRuns]
    .sort((left, right) => right.score - left.score || left.createdAt.localeCompare(right.createdAt))
    .slice(0, PERSONAL_TOP_RUN_LIMIT);
  const displayedBestScore = session
    ? Math.max(game.score, accountBestScore)
    : game.bestScore;
  const personalRuns = session ? accountRecentRuns : localRuns.slice(0, PERSONAL_RECENT_RUN_LIMIT);
  const personalTopRuns = session ? accountTopRuns : localTopRuns;
  const personalLabel = session ? "My Runs" : "This Device";
  const personalLoading = session ? accountRunsLoading : false;
  const personalError = session ? accountRunsError : "";

  useEffect(() => {
    if (!leaderboardOpen || leaderboardTab !== "personal") {
      setPersonalVisibleCount(0);
      return;
    }

    if (personalLoading) {
      setPersonalVisibleCount(0);
      return;
    }

    if (personalError || personalRuns.length === 0) {
      setPersonalVisibleCount(personalRuns.length);
      return;
    }

    setPersonalVisibleCount(1);

    if (soundEnabled) {
      playFillCellSound();
    }

    const timers = personalRuns.slice(1).map((_, index) =>
      setTimeout(() => {
        if (soundEnabled) {
          playFillCellSound();
        }

        startTransition(() => {
          setPersonalVisibleCount(index + 2);
        });
      }, (index + 1) * LEADERBOARD_CASCADE_STAGGER_MS)
    );

    return () => timers.forEach(clearTimeout);
  }, [leaderboardOpen, leaderboardTab, personalError, personalLoading, personalRuns, soundEnabled]);

  return (
    <>
      <div className="app-shell">
        <header className="hero">
          <button
            className={`sound-icon-button hero-auth-button${
              showMobileAuthPanel || session ? " is-active" : ""
            }`}
            type="button"
            onClick={handleToggleMobileAuthPanel}
            aria-label={showMobileAuthPanel ? "Close sign in panel" : "Open sign in panel"}
          >
            <UserIcon />
          </button>
          <button
            className="sound-icon-button hero-info-button"
            type="button"
            onClick={() => setShowHowToPlay(true)}
            aria-label="How to play"
          >
            <span className="info-icon-letter" aria-hidden="true">i</span>
          </button>
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
            <div className="score-stack">
              <ScorePanel
                score={game.score}
                bestScore={displayedBestScore}
                combo={game.combo}
              />
              <ScoreboardTrigger onClick={() => handleOpenLeaderboard("personal")} />
            </div>
            <div className="mobile-player-handle">
              <PlayerHandle displayName={profile?.display_name ?? null} />
            </div>
            <div className="desktop-auth-panel">
              <ProfileTrigger active={showDesktopAuthPanel} onClick={handleToggleDesktopAuthPanel} />
              {showDesktopAuthPanel ? (
                <AuthPanel
                  authCode={authCode}
                  authEmail={authEmail}
                  authError={authError}
                  authMessage={authMessage}
                  authPending={authPending}
                  authReady={authReady}
                  displayNameDraft={displayNameDraft}
                  editingProfile={editingProfile}
                  hasConfig={hasSupabaseConfig}
                  onCodeChange={setAuthCode}
                  onCancelEditProfile={handleCancelEditProfile}
                  onDisplayNameChange={handleAuthFieldChange}
                  onEditProfile={handleEditProfile}
                  onRequestCode={handleRequestCode}
                  onResetOtp={handleResetOtp}
                  onSaveProfile={handleSaveProfile}
                  onSignOut={handleSignOut}
                  onVerifyCode={handleVerifyCode}
                  otpSentTo={otpSentTo}
                  profile={profile}
                  profilePending={profilePending}
                  session={session}
                />
              ) : null}
            </div>
          </aside>

          <section className="playfield">
            <div className="playfield-header">
              <div className="desktop-player-handle">
                <PlayerHandle displayName={profile?.display_name ?? null} />
              </div>
            </div>
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
                  <button className="start-button" type="button" onClick={handleStartGame} disabled={startPending}>
                    {startPending ? "Starting..." : "Start Game"}
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
                    <p className={`run-submitting-label${runSubmitting ? "" : " run-submitting-label--hidden"}`}>Submitting...</p>
                    <button className="start-button" type="button" onClick={handleRestart} disabled={startPending}>
                      {startPending ? "Starting..." : "Play Again"}
                    </button>
                    {runSubmissionError ? <p className="leaderboard-empty">{runSubmissionError}</p> : null}
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

        <footer className="site-footer">
          <span>Made by </span>
          <a
            className="site-footer-link"
            href="https://www.threads.com/@dxniel.jxy"
            target="_blank"
            rel="noreferrer"
          >
            @dxniel.jxy
          </a>
          <span className="site-footer-version">v1.0</span>
        </footer>
      </div>

      {showMobileAuthPanel ? (
        <div
          className="mobile-auth-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Player account"
          onClick={handleCloseMobileAuthPanel}
        >
          <div className="mobile-auth-sheet" onClick={(event) => event.stopPropagation()}>
            <button
              className="mobile-auth-close"
              type="button"
              onClick={handleCloseMobileAuthPanel}
              aria-label="Close sign in panel"
            >
              Close
            </button>
            <AuthPanel
              authCode={authCode}
              authEmail={authEmail}
              authError={authError}
              authMessage={authMessage}
              authPending={authPending}
              authReady={authReady}
              displayNameDraft={displayNameDraft}
              editingProfile={editingProfile}
              hasConfig={hasSupabaseConfig}
              onCodeChange={setAuthCode}
              onCancelEditProfile={handleCancelEditProfile}
              onDisplayNameChange={handleAuthFieldChange}
              onEditProfile={handleEditProfile}
              onRequestCode={handleRequestCode}
              onResetOtp={handleResetOtp}
              onSaveProfile={handleSaveProfile}
              onSignOut={handleSignOut}
              onVerifyCode={handleVerifyCode}
              otpSentTo={otpSentTo}
              profile={profile}
              profilePending={profilePending}
              session={session}
            />
          </div>
        </div>
      ) : null}

      {showHowToPlay ? <HowToPlayModal onClose={() => setShowHowToPlay(false)} /> : null}

      <LeaderboardModal
        activeTab={leaderboardTab}
        globalEnabled={GLOBAL_LEADERBOARD_ENABLED}
        globalError={globalError}
        globalLoading={globalLoading}
        globalRuns={globalRuns}
        globalVisibleCount={globalVisibleCount}
        personalError={personalError}
        personalLabel={personalLabel}
        personalLoading={personalLoading}
        personalRuns={personalRuns}
        personalTopRuns={personalTopRuns}
        personalVisibleCount={personalVisibleCount}
        signedIn={Boolean(session)}
        onClose={handleCloseLeaderboard}
        onTabChange={handleLeaderboardTabChange}
        open={leaderboardOpen}
      />

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
