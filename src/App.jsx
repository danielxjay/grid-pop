import { startTransition, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import {
  GRID_SIZE,
  RUN_HISTORY_STORAGE_KEY,
  STORAGE_KEY,
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
  setRankedTray,
  setPreview,
  toIndex,
  togglePieceSelection,
} from "./game.js";
import {
  getSoundVolume,
  isSoundEnabled,
  playClearSound,
  playFillCellSound,
  playPreviewMoveSound,
  playPickupSound,
  playPlaceSound,
  primeSound,
  setSoundEnabled,
  setSoundVolume,
  unlockAndTestSound,
} from "./sound.js";
import { hasSupabaseConfig, supabase } from "./supabase.js";

const TONE_NAMES = ['coral', 'gold', 'mint', 'sky', 'orchid'];

const THEMES = [
  {
    key: "classic", name: "Classic", free: true, hint: "Default",
    grid: [
      [1, 1, 0, 2, 0, 0, 3, 3],
      [0, 1, 0, 2, 2, 0, 0, 3],
      [4, 0, 0, 0, 2, 5, 0, 3],
    ],
  },
  {
    key: "classic-dark", name: "Classic Dark", free: true, hint: "Dark mode edition",
    grid: [
      [1, 0, 2, 2, 0, 3, 0, 4],
      [1, 1, 0, 2, 3, 3, 0, 4],
      [0, 1, 5, 0, 0, 3, 4, 4],
    ],
  },
  {
    key: "tinted", name: "Tinted", free: true, hint: "Okabe-Ito inspired",
    grid: [
      [1, 1, 0, 2, 2, 0, 3, 0],
      [0, 1, 4, 0, 2, 0, 3, 3],
      [5, 4, 4, 0, 0, 0, 0, 3],
    ],
  },
  {
    key: "tinted-plus-plus", name: "Tinted++", free: true, hint: "Accessible + symbol cues",
    grid: [
      [1, 0, 2, 2, 0, 3, 0, 4],
      [1, 5, 0, 2, 0, 3, 4, 4],
      [0, 5, 5, 0, 0, 3, 0, 4],
    ],
  },
  {
    key: "gen-y", name: "Gen Y", unlock: "Play 50 games",
    grid: [
      [0, 1, 0, 0, 0, 2, 0, 0],
      [0, 1, 1, 0, 0, 2, 0, 3],
      [0, 0, 1, 0, 0, 2, 3, 3],
    ],
  },
  {
    key: "washed", name: "Washed", unlock: "Score under 500",
    grid: [
      [0, 0, 0, 1, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 0, 2, 0],
      [0, 0, 0, 0, 0, 0, 2, 2],
    ],
  },
  {
    key: "broadcast", name: "Broadcast", unlock: "Share your stats",
    grid: [
      [0, 1, 0, 2, 0, 3, 0, 4],
      [1, 1, 0, 2, 3, 3, 0, 4],
      [0, 1, 5, 2, 0, 3, 4, 4],
    ],
  },
  {
    key: "dmg", name: "DMG", unlock: "Pop 4+ lines in one burst",
    grid: [
      [1, 1, 2, 2, 3, 3, 4, 4],
      [1, 0, 0, 2, 0, 3, 0, 4],
      [5, 5, 0, 0, 0, 0, 0, 4],
    ],
  },
  {
    key: "y2k", name: "Y2K", unlock: "Score 20,000+",
    grid: [
      [1, 2, 3, 0, 4, 5, 1, 2],
      [1, 2, 3, 3, 4, 5, 0, 2],
      [0, 2, 0, 3, 4, 5, 5, 0],
    ],
  },
  {
    key: "fn-80z", name: "FN 80Z", unlock: "Score 80,000+",
    grid: [
      [1, 0, 0, 2, 0, 0, 3, 0],
      [1, 1, 0, 2, 2, 0, 3, 3],
      [0, 1, 4, 0, 2, 5, 0, 3],
    ],
  },
  {
    key: "dev", name: "Dev", unlock: "Caught poking around", secret: true,
    grid: [
      [1, 0, 2, 0, 3, 0, 4, 0],
      [0, 1, 0, 2, 0, 3, 0, 4],
      [5, 0, 1, 0, 2, 0, 3, 0],
    ],
  },
  {
    key: "summit", name: "Summit", condition: "top10",
    grid: [
      [1, 0, 2, 0, 3, 0, 4, 0],
      [1, 2, 2, 0, 3, 3, 0, 4],
      [0, 2, 0, 3, 0, 3, 4, 4],
    ],
  },
  {
    key: "crown", name: "Crown", condition: "rank1",
    grid: [
      [0, 1, 0, 2, 0, 1, 0, 2],
      [1, 1, 2, 2, 0, 1, 3, 2],
      [0, 0, 2, 0, 3, 3, 3, 0],
    ],
  },
];

const FREE_THEME_KEYS = new Set(THEMES.filter((theme) => theme.free).map((theme) => theme.key));
const ACCESSIBLE_THEME_KEYS = new Set(["tinted", "tinted-plus-plus"]);

function getUnlockedThemes(stats, profile, globalRuns = [], userId = null, devThemeUnlocked = false) {
  const unlocked = new Set(["classic", "tinted", "tinted-plus-plus", "classic-dark"]);
  if (stats?.gamesPlayed >= 50) unlocked.add("gen-y");
  if (stats?.bestLinesCleared >= 4) unlocked.add("dmg");
  if (profile?.has_shared_stats) unlocked.add("broadcast");
  if (stats?.bestScore >= 20000) unlocked.add("y2k");
  if (stats?.bestScore >= 80000) unlocked.add("fn-80z");
  if (stats?.hasLowScore) unlocked.add("washed");
  if (devThemeUnlocked || profile?.dev_theme_unlocked || profile?.theme === "dev") unlocked.add("dev");
  // Conditional themes — only available while the live condition is met
  if (userId && globalRuns.length > 0) {
    if (globalRuns.some((r) => r.userId === userId)) unlocked.add("summit");
    if (globalRuns[0]?.userId === userId) unlocked.add("crown");
  }
  return unlocked;
}

const OTP_LENGTH = 6;
const PROFILE_NAME_LIMIT = 22;
const EMAIL_LENGTH_LIMIT = 320;
const GLOBAL_LEADERBOARD_ENABLED = true;
const GLOBAL_LEADERBOARD_LIMIT = 10;
const PERSONAL_RECENT_RUN_LIMIT = 10;
const PERSONAL_TOP_RUN_LIMIT = 3;
const LEADERBOARD_CASCADE_STAGGER_MS = 55;
const PREVIOUS_CLIENT_VERSION = "gridpop-web-1.4";
const CLIENT_VERSION = "gridpop-web-1.5";
const TRAY_REVEAL_STAGGER_MS = 110;
const NEXT_TRAY_RETRY_DELAYS_MS = [450, 1100];
const MOVE_SYNC_RETRY_DELAYS_MS = [250, 750];
const START_RUN_RETRY_DELAYS_MS = [800, 2000, 5000];
const FINISH_RUN_RETRY_DELAYS_MS = [800, 2000];
const PENDING_RUN_RECOVERY_RETRY_DELAYS_MS = [1000];
const RUN_DEVICE_POLL_INTERVAL_MS = 15000;
const PENDING_RUN_KEY = "gridpop-pending-run";
const ACTIVE_RUN_SESSION_KEY = "gridpop-active-run";
const ACTIVE_RUN_SESSION_VERSION = 1;
const DEV_THEME_UNLOCK_KEY = "gridpop-dev-theme";
const LAST_SEEN_VERSION_STORAGE_KEY = "gridpop-last-seen-version";
const SEEN_THEME_UNLOCKS_STORAGE_KEY = "gridpop-seen-theme-unlocks";
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;
const RETURNING_PLAYER_STORAGE_KEYS = [
  STORAGE_KEY,
  RUN_HISTORY_STORAGE_KEY,
  "gridpop-theme",
  "gridpop-volume",
  "gridpop-stickiness",
  "gridpop-show-accessible",
  "gridpop-confirm-placement",
  "gridpop-crt-filter",
  PENDING_RUN_KEY,
  ACTIVE_RUN_SESSION_KEY,
];

function hasReturningPlayerState() {
  try {
    return RETURNING_PLAYER_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}

function loadLastSeenVersion() {
  try {
    const stored = localStorage.getItem(LAST_SEEN_VERSION_STORAGE_KEY);
    if (stored) {
      return stored;
    }

    return hasReturningPlayerState() ? PREVIOUS_CLIENT_VERSION : CLIENT_VERSION;
  } catch {
    return CLIENT_VERSION;
  }
}

function loadSeenThemeUnlocks() {
  try {
    const stored = localStorage.getItem(SEEN_THEME_UNLOCKS_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return new Set(parsed.filter((key) => typeof key === "string"));
  } catch {
    return null;
  }
}

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

function formatBurstLabel(lines) {
  if (!Number.isFinite(Number(lines)) || Number(lines) <= 0) {
    return "\u2014";
  }

  const count = Math.max(0, Number(lines));
  return `${count} line${count === 1 ? "" : "s"}`;
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
    return fallback;
  }

  return typeof error.message === "string" && error.message.trim() ? error.message.trim() : fallback;
}

function isTransientFunctionTransportError(error) {
  return error instanceof FunctionsRelayError || error instanceof FunctionsFetchError;
}

function isMaintenance503(error) {
  return error instanceof FunctionsHttpError && error.context?.status === 503;
}

function isRetryableRunConnectionError(error) {
  return isMaintenance503(error) || isTransientFunctionTransportError(error);
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

function CogIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M8.09 2.19a2 2 0 0 1 3.82 0l.15.57a6 6 0 0 1 1.04.6l.57-.16a2 2 0 0 1 2.7 2.7l-.16.57a6 6 0 0 1 .6 1.04l.57.15a2 2 0 0 1 0 3.82l-.57.15a6 6 0 0 1-.6 1.04l.16.57a2 2 0 0 1-2.7 2.7l-.57-.16a6 6 0 0 1-1.04.6l-.15.57a2 2 0 0 1-3.82 0l-.15-.57a6 6 0 0 1-1.04-.6l-.57.16a2 2 0 0 1-2.7-2.7l.16-.57a6 6 0 0 1-.6-1.04l-.57-.15a2 2 0 0 1 0-3.82l.57-.15a6 6 0 0 1 .6-1.04l-.16-.57a2 2 0 0 1 2.7-2.7l.57.16a6 6 0 0 1 1.04-.6l.15-.57ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    </svg>
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

function ChartIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="11" width="4" height="7" rx="0.6" />
      <rect x="8" y="6.5" width="4" height="11.5" rx="0.6" />
      <rect x="14.5" y="2" width="4" height="16" rx="0.6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 3.5l3 3L6 17H3v-3L13.5 3.5z" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.5a7.5 7.5 0 1 0 5.5 12.7c.9-1 .3-2.2-.8-2.2h-1.2a2 2 0 0 1 0-4h.1A7.5 7.5 0 0 0 10 2.5z" />
      <circle cx="6.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <rect x="4" y="9" width="12" height="9" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" />
      <path d="M13 13.5l3.5-3.5L13 6.5" />
      <line x1="16.5" y1="10" x2="7.5" y2="10" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4h8v3.5a4 4 0 0 1-8 0V4Z" />
      <path d="M6 5H3.5v1.5A3.5 3.5 0 0 0 7 10" />
      <path d="M14 5h2.5v1.5A3.5 3.5 0 0 1 13 10" />
      <path d="M10 11.5V15" />
      <path d="M7 16h6" />
    </svg>
  );
}

function ScorePanel({ score, bestScore, combo, onClick }) {
  return (
    <button
      className="score-panel score-panel--button"
      type="button"
      onClick={onClick}
      aria-label="Open this device scores"
    >
      <div className="score-stat">
        <p className="section-label">Run Score</p>
        <strong className="score-value">{score}</strong>
      </div>
      <div className="score-stat">
        <p className="section-label">Best</p>
        <strong className="score-value">{bestScore}</strong>
      </div>
      <div className="score-stat">
        <p className="section-label">Chain Bonus</p>
        <strong className="score-value">x{Math.max(1, combo + 1)}</strong>
      </div>
    </button>
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

async function buildStatsCardBlob(displayName, stats) {
  const W = 1080;
  const PAD = 80;
  const GAP = 18;
  const FOOTER_SIZE = 26;
  const BOTTOM_PAD = 72;

  await document.fonts.ready;

  // Resolve theme-aware colors from live CSS vars + theme data
  const style = getComputedStyle(document.documentElement);
  const bgTop = style.getPropertyValue('--page-top').trim() || '#cfa8ff';
  const bgBottom = style.getPropertyValue('--page-bottom').trim() || '#9ecfff';
  const textColor = style.getPropertyValue('--fg').trim() || '#38106a';
  const panelColor = style.getPropertyValue('--bg-surface').trim() || 'rgba(255,255,255,0.82)';
  const tones = TONE_NAMES.map(t => style.getPropertyValue(`--tone-${t}`).trim());
  const accent = tones[0];

  // Build chunk data up front so we can calculate total height before creating the canvas
  const hero = stats?.bestScore > 0
    ? [["Best score", stats.bestScore.toLocaleString()]]
    : [];

  const activity = [];
  if (stats?.gamesPlayed > 0) activity.push(["Games played", String(stats.gamesPlayed)]);
  if (stats?.mostMoves > 0) activity.push(["Most moves in a game", String(stats.mostMoves)]);

  const skills = [];
  if (stats?.bestCombo > 0) skills.push(["Highest chain", `\u00d7${stats.bestCombo + 1}`]);
  if (stats?.bestMoveScore > 0) skills.push(["Best single move", stats.bestMoveScore.toLocaleString()]);
  if (stats?.bestLinesCleared > 0) skills.push(["Biggest burst", formatBurstLabel(stats.bestLinesCleared)]);

  // Calculate total height
  const headerH = displayName ? 248 : 180;
  const heroH = hero.length > 0 ? 165 + GAP : 0;
  const activityH = activity.length > 0 ? 138 + GAP : 0;
  const skillsH = skills.length > 0 ? 138 + GAP : 0;
  const footerH = FOOTER_SIZE + BOTTOM_PAD;
  const HEIGHT = headerH + heroH + activityH + skillsH + footerH;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W * 0.75, HEIGHT);
  bg.addColorStop(0, bgTop);
  bg.addColorStop(1, bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, HEIGHT);

  // Subtle radial highlight
  const glowGrad = ctx.createRadialGradient(W * 0.28, HEIGHT * 0.22, 0, W * 0.28, HEIGHT * 0.22, W * 0.65);
  glowGrad.addColorStop(0, "rgba(255,255,255,0.22)");
  glowGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, W, HEIGHT);

  // Tone stripe at top
  tones.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(i * (W / 5), 0, W / 5, 22);
  });

  // GridPop! wordmark — white with accent hard drop shadow
  ctx.font = `bold 64px "Press Start 2P", monospace`;
  ctx.textAlign = "left";
  ctx.fillStyle = accent;
  ctx.fillText("GridPop!", PAD + 6, 148);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("GridPop!", PAD, 142);

  // Player handle
  if (displayName) {
    ctx.font = `bold 26px "Press Start 2P", monospace`;
    ctx.fillStyle = textColor;
    ctx.fillText(displayName, PAD, 206);
  }

  // Helpers
  function drawTile(tx, ty, tw, th, label, value, valueSz, labelSz, hero = false) {
    ctx.globalAlpha = hero ? 1.0 : 0.75;
    ctx.fillStyle = panelColor;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 18);
    ctx.fill();
    ctx.globalAlpha = 1.0;
    if (hero) {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
    ctx.font = `bold ${valueSz}px "Press Start 2P", monospace`;
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.fillText(value, tx + tw / 2, ty + th * 0.5);
    // Hero labels use Press Start 2P; secondary tiles use system-ui
    let sz = labelSz;
    const labelFont = hero
      ? `bold ${sz}px "Press Start 2P", monospace`
      : `400 ${sz}px system-ui, -apple-system, sans-serif`;
    ctx.font = labelFont;
    while (ctx.measureText(label).width > tw - 24 && sz > 13) {
      sz -= 1;
      ctx.font = hero
        ? `bold ${sz}px "Press Start 2P", monospace`
        : `400 ${sz}px system-ui, -apple-system, sans-serif`;
    }
    ctx.globalAlpha = hero ? 0.45 : 0.58;
    ctx.fillStyle = textColor;
    ctx.fillText(label, tx + tw / 2, ty + th * 0.82);
    ctx.globalAlpha = 1.0;
    ctx.textAlign = "left";
  }

  function drawRow(items, rowY, rowH, valueSz, labelSz, isHero = false) {
    const rowW = W - PAD * 2;
    const tileW = (rowW - GAP * (items.length - 1)) / items.length;
    items.forEach(([label, value], i) => {
      drawTile(PAD + i * (tileW + GAP), rowY, tileW, rowH, label, value, valueSz, labelSz, isHero);
    });
  }

  // Draw chunks
  let y = headerH;
  if (hero.length > 0) { drawRow(hero, y, 165, 52, 22, true); y += 165 + GAP; }
  if (activity.length > 0) { drawRow(activity, y, 138, 40, 24); y += 138 + GAP; }
  if (skills.length > 0) { drawRow(skills, y, 138, 34, 21); y += 138 + GAP; }

  // URL footer
  ctx.font = `400 ${FOOTER_SIZE}px "Press Start 2P", monospace`;
  ctx.fillStyle = accent;
  ctx.textAlign = "left";
  ctx.fillText("play now at gridpop.app", PAD, y + FOOTER_SIZE + 10);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Canvas export failed")); return; }
      resolve(blob);
    }, "image/png");
  });
}

const SHARE_CAPTION = "My GridPop! stats";

function StatsModal({ displayName, onClose, onShare, stats, theme }) {
  const title = displayName ? `Stats: ${displayName}` : "Stats";
  const [sharing, setSharing] = useState(false);
  const [saved, setSaved] = useState(false);
  const canNativeShare = !!navigator.share;

  async function handleShare() {
    setSharing(true);
    try {
      const blob = await buildStatsCardBlob(displayName, stats);
      const file = new File([blob], "gridpop-stats.png", { type: "image/png" });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          text: SHARE_CAPTION,
          files: [file],
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "gridpop-stats.png";
        a.click();
        URL.revokeObjectURL(url);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
      onShare?.();
    } catch (err) {
      if (err.name !== "AbortError") console.error("Share failed", err);
    } finally {
      setSharing(false);
    }
  }

  return (
    <div
      className="how-to-play-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="how-to-play-wrap" onClick={(event) => event.stopPropagation()}>
        <button className="leaderboard-close" type="button" onClick={onClose} aria-label="Close stats">
          Close
        </button>
        <section className="how-to-play-modal stats-modal">
          <div className="leaderboard-colour-strip" aria-hidden="true" />
          <h2>{title}</h2>
          {stats ? (
            <dl className="stats-list">
              <div className="stats-row">
                <dt>Best score</dt>
                <dd>{stats.bestScore.toLocaleString()}</dd>
              </div>
              <div className="stats-row">
                <dt>Games played</dt>
                <dd>{stats.gamesPlayed}</dd>
              </div>
              <div className="stats-row">
                <dt>Most moves in a game</dt>
                <dd>{stats.mostMoves > 0 ? stats.mostMoves : "\u2014"}</dd>
              </div>
              <div className="stats-row">
                <dt>Highest chain</dt>
                <dd>{stats.bestCombo > 0 ? `\u00d7${stats.bestCombo + 1}` : "\u2014"}</dd>
              </div>
              <div className="stats-row">
                <dt>Best single move</dt>
                <dd>{stats.bestMoveScore > 0 ? stats.bestMoveScore.toLocaleString() : "\u2014"}</dd>
              </div>
              <div className="stats-row">
                <dt>Biggest burst</dt>
                <dd>{formatBurstLabel(stats.bestLinesCleared)}</dd>
              </div>
            </dl>
          ) : (
            <p className="auth-copy">Play some games to see your stats here.</p>
          )}
          <button
            className="stats-share-btn"
            type="button"
            onClick={handleShare}
            disabled={sharing}
          >
            {sharing ? "Generating\u2026" : saved ? "Saved!" : canNativeShare ? "Share stats" : "Download stats"}
          </button>
        </section>
      </div>
    </div>
  );
}

function HowToPlayModal({ onClose, onOpenChangelog, hasUnreadChangelog }) {
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
                <p>Drag a shape from the tray onto the grid. Each coloured square is a poxel and every poxel you place scores points.</p>
                <p className="how-to-play-pts">15 pts per poxel</p>
              </div>
            </div>
            <div className="how-to-play-step">
              <MiniBoard grid={clearGrid} />
              <div className="how-to-play-step-body">
                <strong className="how-to-play-step-title">Pop</strong>
                <p>Fill a row or column with poxels and the whole line pops. Pop multiple lines in one move to trigger a "burst" bonus.</p>
                <p className="how-to-play-pts">180 pts per line, plus extra for bursts</p>
              </div>
            </div>
            <div className="how-to-play-step">
              <div className="how-to-play-combo-badges" aria-hidden="true">
                <span className="how-to-play-badge">×1</span>
                <span className="how-to-play-badge">×2</span>
                <span className="how-to-play-badge how-to-play-badge--hot">×3</span>
              </div>
              <div className="how-to-play-step-body">
                <strong className="how-to-play-step-title">Chain Bonus</strong>
                <p>Pop lines back-to-back to grow your chain bonus multiplier.</p>
                <p className="how-to-play-pts">Each line popped in a row adds ×1</p>
              </div>
            </div>
          </div>
          <p className="how-to-play-footer">
            The game ends when no shape in the tray can fit on the grid.
          </p>
          <p className="how-to-play-credit">
            Made by{" "}
            <a
              className="site-footer-link"
              href="https://www.threads.com/@dxniel.jxy"
              target="_blank"
              rel="noreferrer"
            >
              @dxniel.jxy
            </a>
            {" · "}
            <button
              className="site-footer-version site-footer-version--button"
              type="button"
              onClick={onOpenChangelog}
              aria-label={hasUnreadChangelog ? `View changelog for new in version ${CLIENT_VERSION.replace("gridpop-web-", "")}` : "View changelog"}
            >
              <span>{CLIENT_VERSION.replace("gridpop-web-", "v")}</span>
              {hasUnreadChangelog ? <span className="ui-pill-badge">New!</span> : null}
            </button>
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

function ChangelogModal({ onClose }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    fetch("/changelog.json")
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  return (
    <div
      className="how-to-play-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Changelog"
      onClick={onClose}
    >
      <div className="how-to-play-wrap" onClick={(e) => e.stopPropagation()}>
        <button className="leaderboard-close" type="button" onClick={onClose} aria-label="Close changelog">
          Close
        </button>
        <div className="how-to-play-modal changelog-modal">
          <div className="leaderboard-colour-strip" aria-hidden="true" />
          <h2>What&rsquo;s New</h2>
          {entries === null ? (
            <div className="overlay-spinner" aria-label="Loading" role="status">
              <span className="overlay-spinner-dot" />
              <span className="overlay-spinner-dot" />
              <span className="overlay-spinner-dot" />
            </div>
          ) : entries.length === 0 ? (
            <p className="changelog-empty">No changelog available.</p>
          ) : (
            <div className="changelog-entries">
              {entries.map((entry) => (
                <div key={entry.version} className="changelog-entry">
                  <div className="changelog-entry-header">
                    <span className="changelog-version">v{entry.version}</span>
                    <span className="changelog-date">{entry.date}</span>
                  </div>
                  <ul className="changelog-list">
                    {entry.changes.map((change, i) => (
                      <li key={i} className="changelog-item">{change}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerHandleStatus({ message }) {
  if (!message) {
    return null;
  }

  return <p className="player-handle player-handle--status">{message}</p>;
}

function MenuTrigger({ active, onClick }) {
  return (
    <button
      className={`profile-trigger${active ? " is-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-label={active ? "Close menu" : "Open menu"}
    >
      <CogIcon />
      <span>Menu</span>
    </button>
  );
}

function ThemeTrigger({ active, hasUnread = false, mobile = false, onClick }) {
  if (mobile) {
    return (
      <button
        className={`sound-icon-button hero-theme-button${active ? " is-active" : ""}`}
        type="button"
        onClick={onClick}
        aria-label={active ? "Close themes" : hasUnread ? "Open themes, new theme unlocked" : "Open themes"}
      >
        <PaletteIcon />
        {hasUnread ? <span className="ui-dot-badge" aria-hidden="true" /> : null}
      </button>
    );
  }

  return (
    <button
      className={`theme-trigger${active ? " is-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-label={active ? "Close themes" : hasUnread ? "Open themes, new theme unlocked" : "Open themes"}
    >
      <PaletteIcon />
      <span>Themes</span>
      {hasUnread ? <span className="ui-dot-badge" aria-hidden="true" /> : null}
    </button>
  );
}

function ScoreboardTrigger({ onClick }) {
  return (
    <button className="scoreboard-trigger" type="button" onClick={onClick} aria-label="Open global leaderboard">
      <TrophyIcon />
      <span>Leaderboard</span>
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
  personalRunCount,
  personalRuns,
  personalRunNumbers,
  personalTopRuns,
  personalTopRunNumbers,
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
  const modalTitle = globalEnabled && activeTab === "global" ? "Leaderboard" : "Scores";

  return (
    <div
      className="leaderboard-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      onClick={onClose}
    >
      <div className="leaderboard-modal-wrap" onClick={(event) => event.stopPropagation()}>
        <button className="leaderboard-close" type="button" onClick={onClose} aria-label={`Close ${modalTitle.toLowerCase()}`}>
          Close
        </button>
        <section className="leaderboard-modal">
          <div className="leaderboard-colour-strip" aria-hidden="true" />
          <h2>{modalTitle}</h2>

        <div className="leaderboard-tabs" role="tablist" aria-label="Score sections">
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
            <section className="leaderboard-section">
              <p className="section-label">Best Runs</p>
              {bestPersonalRun ? (
                <div className="leaderboard-podium" role="list" aria-label={`${personalLabel} best runs`}>
                  {personalTopRuns.map((run, index) => (
                    <div
                      key={`${run.id ?? run.createdAt}-${run.score}-top-${index}`}
                      className="leaderboard-podium-card"
                      role="listitem"
                    >
                      <span className="leaderboard-podium-rank">
                        {String(
                          personalTopRunNumbers[String(run.id)] ??
                          Math.max(1, personalRunCount - index)
                        ).padStart(2, "0")}
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
            </section>

            <section className="leaderboard-section">
              <p className="section-label">Recent Runs</p>
              {personalLoading ? <p className="leaderboard-empty">Loading {personalLabel.toLowerCase()}...</p> : null}
              {!personalLoading && personalError ? <p className="leaderboard-empty">{personalError}</p> : null}
              {!personalLoading && !personalError && personalRuns.length > 0 ? (
                <ol className="leaderboard-list leaderboard-list-local">
                  {personalRuns.map((run, index) =>
                    index < personalVisibleCount ? (
                      <li key={`personal-visible-${run.id ?? run.createdAt}-${run.score}-${index}`} className="leaderboard-row leaderboard-row--pop">
                        <span className="leaderboard-rank">
                          {String(
                            personalRunNumbers[String(run.id)] ??
                            Math.max(1, personalRunCount - index)
                          ).padStart(2, "0")}
                        </span>
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
            </section>
          </div>
        ) : (
          <div key="global-panel" className="leaderboard-panel">
            <section className="leaderboard-section leaderboard-section--hero">
              {globalLoading ? (
                <>
                  <div className="leaderboard-hero leaderboard-hero--global leaderboard-hero--skeleton" aria-hidden="true">
                    <span className="leaderboard-hero-rank">&nbsp;</span>
                    <strong className="leaderboard-hero-score">&nbsp;</strong>
                    <span className="leaderboard-hero-name">&nbsp;</span>
                  </div>
                  <div className="leaderboard-hero-spinner" aria-hidden="true">
                    <span className="overlay-spinner-dot" />
                    <span className="overlay-spinner-dot" />
                    <span className="overlay-spinner-dot" />
                  </div>
                </>
              ) : null}
              {!globalLoading && globalTopRun ? (
                <div className="leaderboard-hero leaderboard-hero--global">
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
            </section>

            <section className="leaderboard-section leaderboard-section--global-list">
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
            </section>
          </div>
        )}
        </section>
      </div>
    </div>
  );
}

function ThemePreviewBoard({ themeKey, grid }) {
  return (
    <div className="theme-preview-board" data-theme={themeKey} style={{ background: 'var(--board-bg)' }}>
      {grid.flat().map((tone, i) =>
        tone === 0 ? (
          <div
            key={i}
            className="theme-preview-cell theme-preview-cell--empty"
            style={{ background: 'var(--board-cell-bg)', borderColor: 'var(--board-cell-border)' }}
          />
        ) : (
          <div key={i} className="theme-preview-cell theme-preview-cell--filled">
            <div
              className={`theme-preview-bubble tone-${TONE_NAMES[tone - 1]}`}
              style={{ background: 'var(--cell-bg)' }}
            />
          </div>
        )
      )}
    </div>
  );
}

function getThemeUnlockHint(theme) {
  if (theme.hint) return theme.hint;
  if (theme.free) return "Free";
  if (theme.key === "dev") return "Theme override detected";
  if (theme.condition === "rank1") return "Hold the #1 spot";
  if (theme.condition === "top10") return "Hold a top 10 spot";
  return theme.unlock;
}

function ThemeModal({ activeTheme, showAccessibleThemes, signedIn, unlockedThemes, onGuestSignIn, onSelect, onClose }) {
  const visibleThemes = THEMES.filter(
    (theme) =>
      (!theme.secret || unlockedThemes.has(theme.key)) &&
      (showAccessibleThemes || !ACCESSIBLE_THEME_KEYS.has(theme.key) || activeTheme === theme.key)
  );
  const equippedTheme = visibleThemes.find((t) => t.key === activeTheme) ?? null;
  const otherThemes = visibleThemes.filter((t) => t.key !== activeTheme);

  return (
    <div
      className="how-to-play-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Themes"
      onClick={onClose}
    >
      <div className="how-to-play-wrap theme-modal-wrap" onClick={(e) => e.stopPropagation()}>
        <button className="leaderboard-close" type="button" onClick={onClose} aria-label="Close themes">
          Close
        </button>
        <section className="how-to-play-modal">
          <div className="leaderboard-colour-strip" aria-hidden="true" />
          <h2>Themes</h2>

          {equippedTheme && (
            <div className="theme-picker">
              <button className="theme-card is-active" type="button" disabled aria-label={`${equippedTheme.name} theme, currently equipped`}>
                <ThemePreviewBoard themeKey={equippedTheme.key} grid={equippedTheme.grid} />
                <div className="theme-card-label">
                  <span className="theme-card-name">{equippedTheme.name}</span>
                  <span className="theme-card-hint theme-card-hint--equipped">Equipped</span>
                </div>
              </button>
            </div>
          )}

          {otherThemes.length > 0 && (
            <>
              <div className="theme-picker-divider" aria-hidden="true" />
              <p className="theme-picker-section-label">Switch theme</p>
              <div className="theme-picker">
                {otherThemes.map((theme) => {
                  const isUnlocked = unlockedThemes.has(theme.key);
                  const cardClassName = `theme-card${!isUnlocked ? " is-locked" : ""}${!isUnlocked && !signedIn ? " is-guest-locked" : ""}`;
                  const cardPreview = <ThemePreviewBoard themeKey={theme.key} grid={theme.grid} />;
                  const cardLabel = (
                    <div className="theme-card-label">
                      <span className="theme-card-name">{theme.name}</span>
                      <span className="theme-card-hint">{getThemeUnlockHint(theme)}</span>
                    </div>
                  );

                  if (!isUnlocked && !signedIn) {
                    return (
                      <div key={theme.key} className={cardClassName} role="group" aria-label={`${theme.name} theme locked`}>
                        {cardPreview}
                        <div className="theme-card-obscured-layer" aria-hidden="true" />
                        <div className="theme-card-lock-overlay theme-card-lock-overlay--guest">
                          <LockIcon />
                          <button className="theme-card-lock-cta-button" type="button" onClick={onGuestSignIn}>
                            Sign in to view
                          </button>
                        </div>
                        {cardLabel}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={theme.key}
                      className={cardClassName}
                      type="button"
                      disabled={!isUnlocked}
                      onClick={() => isUnlocked && onSelect(theme.key)}
                    >
                      {cardPreview}
                      {!isUnlocked && (
                        <div className="theme-card-lock-overlay">
                          <LockIcon />
                        </div>
                      )}
                      {cardLabel}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function SettingsPanel({
  soundVolume,
  onVolumeChange,
  gridStickiness,
  onStickinessChange,
  showAccessibleThemes,
  onShowAccessibleThemesChange,
  confirmPlacement,
  onConfirmPlacementChange,
  crtFilterLevel,
  onCrtFilterLevelChange,
}) {
  return (
    <section className="settings-panel">
      <h2>Settings</h2>

      <div className="settings-group">
        <p className="settings-group-label">Audio</p>
        <div className="settings-row">
          <label className="settings-row-label" htmlFor="setting-volume">Volume</label>
          <div className="settings-row-control">
            <span className="settings-volume-icon" aria-hidden="true">
              <SpeakerIcon on={false} />
            </span>
            <input
              id="setting-volume"
              className="settings-slider"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={soundVolume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
            />
            <span className="settings-volume-icon" aria-hidden="true">
              <SpeakerIcon on />
            </span>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <p className="settings-group-label">Controls</p>
        <div className="settings-row">
          <span className="settings-row-label">Grid Snap</span>
          <div className="settings-row-control">
            <div className="settings-segmented" role="group" aria-label="Grid snap strength">
              {STICKINESS_LEVELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`settings-segmented-btn${gridStickiness === value ? " is-active" : ""}`}
                  onClick={() => onStickinessChange(value)}
                  aria-pressed={gridStickiness === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={confirmPlacement}
          className={`settings-toggle-row${confirmPlacement ? " is-on" : ""}`}
          onClick={() => onConfirmPlacementChange(!confirmPlacement)}
        >
          <span className="settings-toggle-label">Confirm before placing</span>
          <span className="settings-toggle" aria-hidden="true" />
        </button>
      </div>

      <div className="settings-group">
        <p className="settings-group-label">Display</p>
        <div className="settings-row">
          <span className="settings-row-label">CRT Filter</span>
          <div className="settings-row-control">
            <div className="settings-segmented" role="group" aria-label="CRT filter strength">
              {CRT_FILTER_LEVELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`settings-segmented-btn${crtFilterLevel === value ? " is-active" : ""}`}
                  onClick={() => onCrtFilterLevelChange(value)}
                  aria-pressed={crtFilterLevel === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={showAccessibleThemes}
          className={`settings-toggle-row${showAccessibleThemes ? " is-on" : ""}`}
          onClick={() => onShowAccessibleThemesChange(!showAccessibleThemes)}
        >
          <span className="settings-toggle-label">Show accessible themes</span>
          <span className="settings-toggle" aria-hidden="true" />
        </button>
      </div>
    </section>
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
  focusEmail,
  hasConfig,
  onCodeChange,
  onCancelEditProfile,
  onDisplayNameChange,
  onEditProfile,
  onRequestCode,
  onResetOtp,
  onSaveProfile,
  onShowStats,
  onSignOut,
  onVerifyCode,
  otpSentTo,
  profile,
  profileLoading,
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
          <p className="auth-copy">Enter your email to receive a sign-in code.</p>
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
              autoFocus={focusEmail}
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
            <span>{maskEmail(session.user.email)}</span>
          </div>
          {profileLoading ? null : profile?.display_name && !editingProfile ? (
            <>
              <div className="auth-actions">
                <button className="auth-secondary-button auth-secondary-button--icon" type="button" onClick={onShowStats}>
                  <ChartIcon />
                  <span>Stats</span>
                </button>
                <button className="auth-secondary-button auth-secondary-button--icon" type="button" onClick={onEditProfile} disabled={profilePending}>
                  <PencilIcon />
                  <span>Edit Name</span>
                </button>
                <hr className="auth-actions-divider" />
                <button className="auth-secondary-button auth-secondary-button--icon" type="button" onClick={onSignOut} disabled={profilePending}>
                  <SignOutIcon />
                  <span>Sign Out</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="auth-copy">
                {profile?.display_name
                  ? "Update your public display name."
                  : "Enter a display name for the global leaderboard."}
              </p>
              <form className="auth-form auth-form-inline" onSubmit={onSaveProfile}>
                <label className="auth-field">
                  <span className="auth-label">Display Name</span>
                  <input
                    className="auth-input"
                    type="text"
                    value={displayNameDraft}
                    onChange={(event) => onDisplayNameChange("profile", event.target.value)}
                    placeholder="e.g. PoxelPopper67"
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
              {!editingProfile ? (
                <button className="auth-secondary-button" type="button" onClick={onSignOut} disabled={profilePending}>
                  Sign Out
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {authMessage ? <p className="auth-status">{authMessage}</p> : null}
      {authError ? <p className="auth-error">{authError}</p> : null}
    </section>
  );
}


function Tray({
  tray,
  selectedPieceId,
  gameOver,
  interactionLocked,
  started,
  awaitingTray,
  nextTrayPending,
  nextTrayError,
  trayRevealToken,
  soundEnabled,
  onTrayPieceReveal,
  onRetryNextTray,
  onSelectPiece,
  onStartDrag,
}) {
  const [revealedPieceIds, setRevealedPieceIds] = useState(() => new Set());
  const revealTimersRef = useRef([]);
  const lastRevealTokenRef = useRef(0);
  const pieceIdsKey = tray.filter(Boolean).map((piece) => piece.id).join(",");

  useEffect(() => {
    revealTimersRef.current.forEach(clearTimeout);
    revealTimersRef.current = [];

    if (!started) {
      setRevealedPieceIds(new Set());
      return undefined;
    }

    const pieceIds = tray.filter(Boolean).map((piece) => piece.id);

    if (pieceIds.length === 0) {
      setRevealedPieceIds(new Set());
      return undefined;
    }

    // Only stagger-reveal when a new tray token arrives; piece placements that
    // change pieceIdsKey should just reveal the remaining pieces immediately.
    if (!trayRevealToken || trayRevealToken === lastRevealTokenRef.current) {
      setRevealedPieceIds(new Set(pieceIds));
      return undefined;
    }

    lastRevealTokenRef.current = trayRevealToken;
    const shuffledIds = [...pieceIds].sort(() => Math.random() - 0.5);
    setRevealedPieceIds(new Set());

    shuffledIds.forEach((pieceId, index) => {
      const timer = window.setTimeout(() => {
        setRevealedPieceIds((current) => {
          const next = new Set(current);
          next.add(pieceId);
          return next;
        });

        if (soundEnabled) {
          onTrayPieceReveal();
        }
      }, index * TRAY_REVEAL_STAGGER_MS);

      revealTimersRef.current.push(timer);
    });

    return () => {
      revealTimersRef.current.forEach(clearTimeout);
      revealTimersRef.current = [];
    };
  }, [onTrayPieceReveal, pieceIdsKey, soundEnabled, started, trayRevealToken]);

  if (awaitingTray) {
    return (
      <div className="tray" aria-live="polite" aria-busy={nextTrayPending}>
        {Array.from({ length: TRAY_SIZE }, (_, index) => (
          <button key={`awaiting-${index}`} className="piece-button piece-button--loading" type="button" disabled aria-hidden="true">
            <span className="tray-spinner" aria-hidden="true">
              <span className="tray-spinner-dot" />
              <span className="tray-spinner-dot" />
              <span className="tray-spinner-dot" />
            </span>
          </button>
        ))}
        {nextTrayError ? (
          <button className="tray-status-button" type="button" onClick={onRetryNextTray} disabled={nextTrayPending || interactionLocked}>
            {nextTrayError}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tray" aria-label="Available shapes">
      {Array.from({ length: TRAY_SIZE }, (_, index) => {
        const piece = started ? tray[index] : null;

        if (!piece) {
          return (
            <button key={`empty-${index}`} className="piece-button is-empty" type="button" disabled />
          );
        }

        const isRevealed = revealedPieceIds.has(piece.id);

        return (
          <button
            key={piece.id}
            className={`piece-button${selectedPieceId === piece.id ? " is-selected" : ""}${isRevealed ? " piece-button--reveal" : " piece-button--loading"}`}
            type="button"
            data-piece-id={piece.id}
            aria-label={`${piece.shape.name} piece`}
            onClick={() => onSelectPiece(piece.id)}
            onPointerDown={(event) => onStartDrag(piece, event)}
            disabled={gameOver || interactionLocked || !started || !isRevealed}
          >
            {isRevealed ? <PieceGrid piece={piece} /> : (
              <span className="tray-spinner" aria-hidden="true">
                <span className="tray-spinner-dot" />
                <span className="tray-spinner-dot" />
                <span className="tray-spinner-dot" />
              </span>
            )}
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
  interactionLocked,
  lockedPreviewPath,
  lockedPreviewSet,
  lockedPreviewTone,
  previewClearSet,
  previewTone,
  started,
  onBoardMove,
  onBoardLeave,
  onCellClick,
  onLockedPreviewPointerDown,
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
        const isLockedPreview = !stored && lockedPreviewSet?.has(index) && Boolean(lockedPreviewTone);
        const effectiveTone = isWillClear ? previewTone : isLockedPreview ? lockedPreviewTone : (stored?.tone ?? clearedTones[index]);

        const cellStyle = clearedSet.has(index)
          ? buildClearAnimationStyle(row, col, clearedRows, clearedCols)
          : isWillClear
            ? { "--rumble-offset": `${Math.round(getSeededValue(row * 17 + col * 31 + 1, 5) * 800)}ms` }
            : undefined;

        return (
          <button
            key={`${row}-${col}`}
            className={[
              "board-cell",
              effectiveTone && !isLockedPreview ? `is-filled tone-${effectiveTone}` : "",
              isLockedPreview ? `is-locked-preview tone-${effectiveTone}` : "",
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
            onPointerDown={isLockedPreview && onLockedPreviewPointerDown ? onLockedPreviewPointerDown : undefined}
            disabled={!started || interactionLocked}
          />
        );
      })}
      {lockedPreviewPath && (
        <svg className="locked-preview-svg" aria-hidden="true">
          <path d={lockedPreviewPath} />
        </svg>
      )}
    </div>
  );
}

function getSeededValue(seed, offset) {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function buildClearAnimationStyle(row, col, clearedRows, clearedCols) {
  const MAX_DELAY = 160;
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
    "--clear-duration": `${Math.round(660 + getSeededValue(seed, 1) * 120)}ms`,
    "--splash-rotation": `${Math.round(getSeededValue(seed, 2) * 360)}deg`,
    "--splash-scale-x": `${(0.9 + getSeededValue(seed, 3) * 0.45).toFixed(2)}`,
    "--splash-scale-y": `${(0.75 + getSeededValue(seed, 4) * 0.35).toFixed(2)}`,
  };
}

const DRAG_GHOST_LIFT_REM = 0.9;
const DROP_SNAP_SLOP_CELLS = 0.38;
const TRAY_DRAG_START_SLOP_PX = 12;

const STICKINESS_LEVELS = [
  { value: 0,    label: "Off"        },
  { value: 0.3,  label: "Light"      },
  { value: 0.6,  label: "Standard"   },
  { value: 0.92, label: "Aggressive" },
];

const CRT_FILTER_LEVELS = [
  { value: "off", label: "Off" },
  { value: "soft", label: "Soft" },
  { value: "vivid", label: "Vivid" },
];

function getGhostTransform(clientX, clientY) {
  return `translate3d(${clientX}px, ${clientY}px, 0) translate(-50%, calc(-100% - ${DRAG_GHOST_LIFT_REM}rem))`;
}

// Build an SVG path string tracing the outer perimeter of a polyomino shape.
// Convex corners get rounded arcs matching poxel bubble border-radius.
// Returns path in board-padding-box space — coordinates match cell positions
// directly because the SVG lives inside the board element (position: relative).
function buildShapeOutlinePath(cells, placedRow, placedCol, boardEl) {
  if (!boardEl) return null;

  const styles = window.getComputedStyle(boardEl);
  const paddingLeft = parseFloat(styles.paddingLeft || "0");
  const paddingTop  = parseFloat(styles.paddingTop  || "0");
  const gap = parseFloat(styles.gap || styles.rowGap || "0");

  // boardEl.clientLeft = left border width (exact integer, no string parsing needed).
  // boardRect.width is the full border-box width; subtract both borders and both
  // paddings to get the CSS-grid content area used to size each cell.
  const boardRect = boardEl.getBoundingClientRect();
  const borderW = boardEl.clientLeft; // same as borderRight for a symmetric border
  const contentWidth = boardRect.width - 2 * borderW - 2 * paddingLeft;
  const cellSizePx = (contentWidth - gap * (GRID_SIZE - 1)) / GRID_SIZE;
  const stepPx = cellSizePx + gap;
  const halfGap = gap / 2;
  const R = cellSizePx * 0.28; // matches border-radius: 28%
  const Rg = R / stepPx;

  // SVG is position:absolute;inset:0 inside the board (position:relative).
  // Its origin = board's padding edge.  Cell at col C has left = paddingLeft + C*stepPx.
  // Vertex (gx,gy) sits halfGap OUTSIDE each exterior cell edge.
  const vx = (gx) => paddingLeft + gx * stepPx - halfGap;
  const vy = (gy) => paddingTop  + gy * stepPx - halfGap;

  // Occupied set
  const occupied = new Set();
  for (const [dx, dy] of cells) occupied.add(`${placedRow + dy},${placedCol + dx}`);
  const has = (r, c) => occupied.has(`${r},${c}`);

  // Directed exterior edges (CW traversal, interior on the right).
  // Cell (r,c) has corners: TL=(c,r) TR=(c+1,r) BR=(c+1,r+1) BL=(c,r+1)
  const adj = new Map();
  const addEdge = (from, to) => adj.set(`${from[0]},${from[1]}`, { from, to });
  for (const key of occupied) {
    const [r, c] = key.split(',').map(Number);
    if (!has(r - 1, c)) addEdge([c, r],     [c + 1, r]);      // top → east
    if (!has(r, c + 1)) addEdge([c + 1, r], [c + 1, r + 1]); // right → south
    if (!has(r + 1, c)) addEdge([c + 1, r + 1], [c, r + 1]); // bottom → west
    if (!has(r, c - 1)) addEdge([c, r + 1], [c, r]);          // left → north
  }

  // Walk closed loops
  const visited = new Set();
  const loops = [];
  for (const [startKey] of adj) {
    if (visited.has(startKey)) continue;
    const loop = [];
    let curKey = startKey;
    while (!visited.has(curKey) && adj.has(curKey)) {
      visited.add(curKey);
      const { from, to } = adj.get(curKey);
      loop.push(from);
      curKey = `${to[0]},${to[1]}`;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  // Build SVG path
  let d = '';
  for (const loop of loops) {
    const n = loop.length;
    const verts = loop.map((v, i) => {
      const prev = loop[(i - 1 + n) % n];
      const next = loop[(i + 1) % n];
      const inDx = v[0] - prev[0], inDy = v[1] - prev[1];
      const outDx = next[0] - v[0], outDy = next[1] - v[1];
      const cross = inDx * outDy - inDy * outDx; // >0 = CW turn = convex
      return { v, inDx, inDy, outDx, outDy, convex: cross > 0 };
    });

    // Start at departure point of last vertex
    const last = verts[n - 1];
    const sx = last.convex ? vx(last.v[0] + last.outDx * Rg) : vx(last.v[0]);
    const sy = last.convex ? vy(last.v[1] + last.outDy * Rg) : vy(last.v[1]);
    d += `M ${sx} ${sy} `;

    for (const { v, inDx, inDy, outDx, outDy, convex } of verts) {
      if (convex) {
        const ax = vx(v[0] - inDx * Rg), ay = vy(v[1] - inDy * Rg);
        const dpx = vx(v[0] + outDx * Rg), dpy = vy(v[1] + outDy * Rg);
        d += `L ${ax} ${ay} A ${R} ${R} 0 0 1 ${dpx} ${dpy} `;
      } else {
        d += `L ${vx(v[0])} ${vy(v[1])} `;
      }
    }
    d += 'Z ';
  }

  return d.trim() || null;
}

function getBoardCellMetrics(boardElement) {
  if (!boardElement) {
    return null;
  }

  // Measure actual rendered cell positions directly from the DOM instead of
  // deriving them from board padding/border/gap formulas. CSS grid uses
  // browser-internal floating-point that doesn't round-trip through computed
  // styles, so any formula-based stepPx accumulates error across rows/cols.
  const allCells = boardElement.querySelectorAll(".board-cell");
  if (allCells.length < GRID_SIZE + 1) {
    return null;
  }

  const r0 = allCells[0].getBoundingClientRect();
  const r1 = allCells[1].getBoundingClientRect();
  const rN = allCells[GRID_SIZE].getBoundingClientRect();

  const gridLeft = r0.left;
  const gridTop  = r0.top;
  const stepX    = r1.left - r0.left;   // exact horizontal pitch
  const stepY    = rN.top  - r0.top;    // exact vertical pitch
  const cellW    = r0.width;
  const gapX     = stepX - cellW;

  const rootFontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize || "16"
  );

  return {
    gridLeft,
    gridTop,
    gridRight:  gridLeft + (GRID_SIZE - 1) * stepX + cellW,
    gridBottom: gridTop  + (GRID_SIZE - 1) * stepY + r0.height,
    stepX,
    stepY,
    stepPx:     stepX,   // for slop/bounds checks — X ≈ Y on a square grid
    gapPx:      gapX,
    cellSizePx: cellW,
    rootFontSize,
    cellSizeRem: cellW / rootFontSize,
    gapRem:     gapX / rootFontSize,
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
  const rawCol = Math.round((ghostBounds.left - metrics.gridLeft) / metrics.stepX);
  const rawRow = Math.round((ghostBounds.top  - metrics.gridTop)  / metrics.stepY);

  return {
    ghostBounds,
    col: Math.max(0, Math.min(GRID_SIZE - piece.bounds.width, rawCol)),
    row: Math.max(0, Math.min(GRID_SIZE - piece.bounds.height, rawRow)),
  };
}

function matchesPreview(left, right) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return (
    left.pieceId === right.pieceId &&
    left.row === right.row &&
    left.col === right.col &&
    left.valid === right.valid
  );
}

function syncRunSubmittingState(runIds, setRunSubmitting) {
  setRunSubmitting(runIds.size > 0);
}

function resetMoveSyncState(ref) {
  ref.current = { runId: null, moveCount: 0 };
}

function loadActiveRunSession(expectedRunId = null) {
  try {
    const raw = localStorage.getItem(ACTIVE_RUN_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    if (
      !parsed ||
      parsed.version !== ACTIVE_RUN_SESSION_VERSION ||
      typeof parsed.runId !== "string" ||
      !parsed.runId ||
      typeof parsed.deviceToken !== "string" ||
      !parsed.deviceToken ||
      !Array.isArray(parsed.moves)
    ) {
      return null;
    }

    if (expectedRunId && parsed.runId !== expectedRunId) {
      return null;
    }

    return {
      runId: parsed.runId,
      deviceToken: parsed.deviceToken,
      moves: parsed.moves,
      bestScoreBaseline: Number.isFinite(Number(parsed.bestScoreBaseline))
        ? Math.max(0, Number(parsed.bestScoreBaseline))
        : null,
      savedAt: Number.isFinite(Number(parsed.savedAt)) ? Number(parsed.savedAt) : 0,
    };
  } catch {
    return null;
  }
}

function storeActiveRunSession(runId, moves, deviceToken, bestScoreBaseline = null) {
  if (!runId || !deviceToken || !Array.isArray(moves)) {
    return;
  }

  try {
    localStorage.setItem(ACTIVE_RUN_SESSION_KEY, JSON.stringify({
      version: ACTIVE_RUN_SESSION_VERSION,
      runId,
      deviceToken,
      moves,
      bestScoreBaseline: Number.isFinite(Number(bestScoreBaseline))
        ? Math.max(0, Number(bestScoreBaseline))
        : null,
      savedAt: Date.now(),
    }));
  } catch {}
}

function clearActiveRunSession(runId) {
  try {
    const pending = loadActiveRunSession();

    // Passing no run id is the explicit "clear whatever active run this client remembers" path.
    if (!runId || pending?.runId === runId) {
      localStorage.removeItem(ACTIVE_RUN_SESSION_KEY);
    }
  } catch {}
}

function storePendingRun(runId, moves, deviceToken = null) {
  try {
    localStorage.setItem(PENDING_RUN_KEY, JSON.stringify({
      runId,
      moves,
      deviceToken,
      savedAt: Date.now(),
    }));
  } catch {}
}

function clearPendingRun(runId) {
  try {
    const raw = localStorage.getItem(PENDING_RUN_KEY);
    const pending = raw ? JSON.parse(raw) : null;

    if (!runId || pending?.runId === runId) {
      localStorage.removeItem(PENDING_RUN_KEY);
    }
  } catch {}
}

function getAllowedThemeKey(themeKey, unlockedThemes) {
  return unlockedThemes.has(themeKey) ? themeKey : "classic";
}

export default function App({ updateReady = false, onApplyUpdate = () => {}, onDismissUpdate = () => {} }) {
  const [game, setGame] = useState(() => createGameState(loadBestScore()));
  const [drag, setDrag] = useState(null);
  const [soundEnabled, setSoundEnabledState] = useState(() => isSoundEnabled());
  const [soundVolume, setSoundVolumeState] = useState(() => getSoundVolume());
  const lastNonZeroVolumeRef = useRef(getSoundVolume() > 0 ? getSoundVolume() : 1);
  const [gridStickiness, setGridStickiness] = useState(() => {
    try {
      const stored = Number(localStorage.getItem("gridpop-stickiness") ?? "0");
      // Snap stored value to the nearest discrete level (handles old float values)
      const nearest = STICKINESS_LEVELS.reduce((best, lvl) =>
        Math.abs(lvl.value - stored) < Math.abs(best.value - stored) ? lvl : best
      );
      return nearest.value;
    } catch { return 0; }
  });
  const gridStickinessRef = useRef(gridStickiness);
  const [showAccessibleThemes, setShowAccessibleThemes] = useState(() => {
    try { return localStorage.getItem("gridpop-show-accessible") !== "false"; } catch { return true; }
  });
  const [crtFilterLevel, setCrtFilterLevel] = useState(() => {
    try {
      const stored = localStorage.getItem("gridpop-crt-filter");
      if (stored === "true") return "soft";
      return CRT_FILTER_LEVELS.some((level) => level.value === stored) ? stored : "off";
    } catch { return "off"; }
  });
  const [confirmPlacement, setConfirmPlacement] = useState(() => {
    try { return localStorage.getItem("gridpop-confirm-placement") === "true"; } catch { return false; }
  });
  const confirmPlacementRef = useRef(confirmPlacement);
  const [lockedPreview, setLockedPreview] = useState(null);
  const [lockedPreviewPath, setLockedPreviewPath] = useState(null);
  const [started, setStarted] = useState(false);
  const [gameOverPhase, setGameOverPhase] = useState(null); // null | 'filling' | 'overlay'
  const [fillCells, setFillCells] = useState([]);
  const [isNewBest, setIsNewBest] = useState(false);
  const [displayedScore, setDisplayedScore] = useState(0);
  const [scoreFinished, setScoreFinished] = useState(false);
  const [statsRevealed, setStatsRevealed] = useState(0);
  const [showPlayAgain, setShowPlayAgain] = useState(false);
  const [showNewBestBanner, setShowNewBestBanner] = useState(false);
  const [authReady, setAuthReady] = useState(() => !hasSupabaseConfig);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
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
  const [accountRunNumbers, setAccountRunNumbers] = useState({});
  const [accountRunsLoading, setAccountRunsLoading] = useState(false);
  const [accountRunsError, setAccountRunsError] = useState("");
  const [accountStats, setAccountStats] = useState(null);
  const [personalVisibleCount, setPersonalVisibleCount] = useState(0);
  const [globalRuns, setGlobalRuns] = useState([]);
  const [globalVisibleCount, setGlobalVisibleCount] = useState(0);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState("personal");
  const [showDesktopAuthPanel, setShowDesktopAuthPanel] = useState(false);
  const [showMobileAuthPanel, setShowMobileAuthPanel] = useState(false);
  const [authAutoFocus, setAuthAutoFocus] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [lastSeenVersion, setLastSeenVersion] = useState(() => loadLastSeenVersion());
  const [seenThemeUnlocks, setSeenThemeUnlocks] = useState(() => loadSeenThemeUnlocks());
  const [activeTheme, setActiveTheme] = useState(() => { try { return localStorage.getItem("gridpop-theme") ?? "classic"; } catch { return "classic"; } });
  const [devThemeUnlocked, setDevThemeUnlocked] = useState(() => {
    try {
      return localStorage.getItem(DEV_THEME_UNLOCK_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [activeVerifiedRun, setActiveVerifiedRun] = useState(null);
  const [activeRunDetected, setActiveRunDetected] = useState(null);
  const [activeRunCheckDone, setActiveRunCheckDone] = useState(false);
  const [activeRunCheckFailed, setActiveRunCheckFailed] = useState(false);
  const [resumedElsewhere, setResumedElsewhere] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [resumeFailed, setResumeFailed] = useState("");
  const [resumeRunGone, setResumeRunGone] = useState(false);
  const deviceTokenRef = useRef(null);
  const [startPending, setStartPending] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const [runSubmitting, setRunSubmitting] = useState(false);
  const [runSubmissionError, setRunSubmissionError] = useState("");
  const [pendingRunRecoveryPending, setPendingRunRecoveryPending] = useState(false);
  const [nextTrayPending, setNextTrayPending] = useState(false);
  const [nextTrayError, setNextTrayError] = useState("");
  const [moveSyncReconnectPending, setMoveSyncReconnectPending] = useState(false);
  const [nextTrayReconnectPending, setNextTrayReconnectPending] = useState(false);
  const [runReconnectActionRequired, setRunReconnectActionRequired] = useState("");
  const [nextTrayRetryTick, setNextTrayRetryTick] = useState(0);
  const [moveSyncRetryTick, setMoveSyncRetryTick] = useState(0);
  const [trayRevealToken, setTrayRevealToken] = useState(0);
  const [finishRunAttempt, setFinishRunAttempt] = useState(0);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const accountRunsFetchInFlightRef = useRef(false);
  const accountRunsReadyRef = useRef(false);
  const globalFetchInFlightRef = useRef(false);
  const runSubmissionInFlightRef = useRef(new Set());
  const boardRef = useRef(null);
  const dragGhostRef = useRef(null);
  const dismissZoneRef = useRef(null);
  const dragPointerRef = useRef({ x: 0, y: 0 });
  const dragIntentRef = useRef(null);
  const lockedDragStartedRef = useRef(false);
  const pickupSoundPlayedRef = useRef(false);
  const trayDragClickSuppressRef = useRef(false);
  const sliderSoundThrottleRef = useRef(0);
  const authOverlayPointerStartedOnBackdropRef = useRef(false);
  const previewSoundRef = useRef({ key: null, at: 0 });
  const fillIntervalRef = useRef(null);
  const prevBestScoreRef = useRef(game.bestScore);
  const dragBoardMetricsRef = useRef(null);
  const livePreviewRef = useRef(game.preview);
  const queuedPreviewRef = useRef(null);
  const previewFrameRef = useRef(0);
  const activeVerifiedRunRef = useRef(activeVerifiedRun);
  const nextTrayFetchInFlightRef = useRef(false);
  const moveSyncStateRef = useRef({ runId: null, moveCount: 0 });
  const moveSyncInFlightRef = useRef(false);
  const moveSyncRetryTimerRef = useRef(0);
  const nextTrayRetryTimerRef = useRef(0);
  const runDeviceCheckInFlightRef = useRef(false);
  const themeObserverBypassRef = useRef(false);
  const autoResumeAttemptedRunIdRef = useRef(null);

  function resetRunRecoveryState() {
    setMoveSyncReconnectPending(false);
    setNextTrayReconnectPending(false);
    setRunReconnectActionRequired("");
    setNextTrayError("");
    setPendingRunRecoveryPending(false);
    if (moveSyncRetryTimerRef.current) {
      window.clearTimeout(moveSyncRetryTimerRef.current);
      moveSyncRetryTimerRef.current = 0;
    }
    if (nextTrayRetryTimerRef.current) {
      window.clearTimeout(nextTrayRetryTimerRef.current);
      nextTrayRetryTimerRef.current = 0;
    }
  }

  function resetClientSessionState(nextMessage = "") {
    setSession(null);
    setProfile(null);
    setProfileLoading(false);
    setDisplayNameDraft("");
    setEditingProfile(false);
    setShowDesktopAuthPanel(false);
    setShowMobileAuthPanel(false);
    setAccountRecentRuns([]);
    setAccountTopRuns([]);
    setAccountRunNumbers({});
    setAccountStats(null);
    setAccountRunsError("");
    setAccountRunsLoading(false);
    accountRunsReadyRef.current = false;
    setActiveVerifiedRun(null);
    setActiveRunDetected(null);
    setActiveRunCheckDone(false);
    setActiveRunCheckFailed(false);
    setResumedElsewhere(false);
    setResumeFailed("");
    setResumeRunGone(false);
    deviceTokenRef.current = null;
    setAuthCode("");
    setOtpSentTo("");
    setStartPending(false);
    nextTrayFetchInFlightRef.current = false;
    moveSyncInFlightRef.current = false;
    resetMoveSyncState(moveSyncStateRef);
    setNextTrayPending(false);
    resetRunRecoveryState();
    setNextTrayRetryTick(0);
    setMoveSyncRetryTick(0);
    setTrayRevealToken(0);
    if (nextMessage) {
      setAuthMessage(nextMessage);
    }
  }


  const syncDevThemeUnlock = useEffectEvent(async () => {
    if (!hasSupabaseConfig || !session?.user?.id || profile?.dev_theme_unlocked) {
      return;
    }

    setProfile((current) => current ? { ...current, dev_theme_unlocked: true } : current);

    const { error } = await supabase
      .from("profiles")
      .update({ dev_theme_unlocked: true })
      .eq("id", session.user.id);

    if (error) {
      setAuthError("Dev theme unlocked locally but could not sync to your account.");
    }
  });

  const handleTrayPieceReveal = useEffectEvent(() => {
    playFillCellSound();
  });


  useEffect(() => {
    const root = document.documentElement;
    themeObserverBypassRef.current = true;
    root.setAttribute("data-theme", activeTheme);
    queueMicrotask(() => {
      themeObserverBypassRef.current = false;
    });

    const observer = new MutationObserver(() => {
      if (themeObserverBypassRef.current) {
        return;
      }

      if (root.getAttribute("data-theme") !== activeTheme) {
        console.log("Sneaky sneaky! Dev unlocked.");
        if (!devThemeUnlocked) {
          setDevThemeUnlocked(true);
          try { localStorage.setItem(DEV_THEME_UNLOCK_KEY, "true"); } catch {}
        }
        void syncDevThemeUnlock();

        if (activeTheme !== "dev") {
          setActiveTheme("dev");
          return;
        }

        themeObserverBypassRef.current = true;
        root.setAttribute("data-theme", "dev");
        queueMicrotask(() => {
          themeObserverBypassRef.current = false;
        });
      }
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, [activeTheme, devThemeUnlocked]);

  useEffect(() => {
    if (crtFilterLevel === "off") {
      document.documentElement.removeAttribute("data-crt-filter");
      return;
    }

    document.documentElement.setAttribute("data-crt-filter", crtFilterLevel);
  }, [crtFilterLevel]);

  useEffect(() => {
    if (!devThemeUnlocked || profile?.dev_theme_unlocked) {
      return;
    }

    void syncDevThemeUnlock();
  }, [devThemeUnlocked, profile?.dev_theme_unlocked, session?.user?.id]);

  useEffect(() => {
    livePreviewRef.current = game.preview;
  }, [game.preview]);

  useEffect(() => {
    activeVerifiedRunRef.current = activeVerifiedRun;
  }, [activeVerifiedRun]);

  const verifyActiveRunDeviceToken = useEffectEvent(async (runId) => {
    if (!runId || !deviceTokenRef.current || runDeviceCheckInFlightRef.current) {
      return;
    }

    runDeviceCheckInFlightRef.current = true;

    try {
      const { data, error } = await supabase.from("runs").select("device_token").eq("id", runId).maybeSingle();
      if (error) {
        return;
      }
      // Run was abandoned by another device starting fresh, or device token changed.
      if (!data || (deviceTokenRef.current && data.device_token !== deviceTokenRef.current)) {
        setResumedElsewhere(true);
      }
    } finally {
      runDeviceCheckInFlightRef.current = false;
    }
  });

  const rankedReady = Boolean(
    GLOBAL_LEADERBOARD_ENABLED && hasSupabaseConfig && session?.user?.id && profile?.display_name
  );
  const startAuthPending = Boolean(hasSupabaseConfig && !authReady);
  const startProfilePending = Boolean(session?.user?.id && profileLoading);
  const startAccountPending = Boolean(session?.user?.id && !accountRunsReadyRef.current);
  const startNeedsDisplayName = Boolean(session?.user?.id && !profileLoading && !profile?.display_name);
  const startBlocked = Boolean(startPending || startAuthPending || startProfilePending || startAccountPending);
  const detectedRunPreferredSession = activeRunDetected?.id ? loadActiveRunSession(activeRunDetected.id) : null;
  const autoResumeDetectedRun = Boolean(activeRunCheckDone && activeRunDetected?.id && detectedRunPreferredSession);
  const localActiveRunSession = !started && rankedReady ? loadActiveRunSession() : null;
  const pendingSameDeviceResume = Boolean(
    !started &&
    rankedReady &&
    localActiveRunSession?.runId &&
    (!activeRunCheckDone || activeRunDetected?.id === localActiveRunSession.runId)
  );
  const startBlockedMessage = startAuthPending || startProfilePending
    ? "Loading your account..."
    : startAccountPending
      ? "Loading your score history..."
      : activeRunCheckFailed
        ? "Couldn't check for unfinished runs. Starting will try again."
      : startNeedsDisplayName
        ? "Set a display name before starting."
        : "";
  const runReconnectActive = moveSyncReconnectPending || nextTrayReconnectPending;
  const runInteractionLocked = Boolean(started && (runReconnectActive || runReconnectActionRequired || resumePending));
  const playerHandleMessage = started
    ? (
        runReconnectActive || resumePending
          ? "Reconnecting..."
          : runSubmitting
            ? "Saving your score..."
            : ""
      )
    : (
        pendingSameDeviceResume
          ? "Reconnecting..."
          : startPending
          ? "Starting your run..."
          : resumePending
            ? "Reconnecting..."
            : pendingRunRecoveryPending
              ? "Saving your last run..."
              : !startFailed
                ? startBlockedMessage
                : ""
      );
  const startOverlayPassiveMessage = autoResumeDetectedRun || pendingSameDeviceResume || resumePending
    ? "Reconnecting..."
    : startPending || startAuthPending || startProfilePending || startAccountPending
      ? "Starting your run..."
      : "";
  const showRunReconnectOverlay = Boolean(
    started &&
    !game.gameOver &&
    !resumedElsewhere &&
    runReconnectActionRequired
  );
  const runReconnectOverlayMessage = runReconnectActionRequired === "next-tray" && nextTrayError
    ? nextTrayError
    : runReconnectActionRequired === "resume-gone" && resumeFailed
      ? resumeFailed
      : "Couldn't reconnect to your run.";

  useEffect(() => {
    if (updateReady) {
      setUpdateDismissed(false);
    }
  }, [updateReady]);

  useEffect(() => {
    document.body.classList.toggle("is-dragging", Boolean(drag?.armed));

    return () => {
      document.body.classList.remove("is-dragging");
    };
  }, [drag?.armed]);

  useEffect(() => {
    if (game.bestScore > 0) {
      saveBestScore(game.bestScore);
    }
  }, [game.bestScore]);

  const loadAccountRuns = useEffectEvent(async () => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !hasSupabaseConfig || !session?.user?.id) {
      setAccountRecentRuns([]);
      setAccountTopRuns([]);
      setAccountRunNumbers({});
      setAccountStats(null);
      setAccountRunsError("");
      return;
    }

    if (accountRunsFetchInFlightRef.current) {
      return;
    }

    accountRunsFetchInFlightRef.current = true;
    setAccountRunsLoading(true);
    setAccountRunsError("");

    const [recentResult, topResult, verifiedStatsResult, lowScoreResult, numberingResult] = await Promise.all([
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
      supabase
        .from("scores")
        .select("id, created_at, best_combo, best_move_score, best_lines_cleared, move_count", { count: "exact" })
        .eq("user_id", session.user.id)
        .not("run_id", "is", null),
      supabase
        .from("scores")
        .select("id")
        .eq("user_id", session.user.id)
        .not("run_id", "is", null)
        .lt("score", 500)
        .limit(1),
      supabase
        .from("scores")
        .select("id, created_at", { count: "exact" })
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false }),
    ]);

    setAccountRunsLoading(false);
    accountRunsFetchInFlightRef.current = false;

    if (recentResult.error || topResult.error || numberingResult.error) {
      setAccountRecentRuns([]);
      setAccountTopRuns([]);
      setAccountRunNumbers({});
      setAccountStats(null);
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
    const statsRows = verifiedStatsResult.data ?? [];
    const numberingRows = numberingResult.data ?? [];
    const accountRunNumberMap = Object.fromEntries(
      [...numberingRows]
        .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")))
        .map((run, index) => [String(run.id), Math.max(1, (numberingResult.count ?? numberingRows.length) - index)])
    );
    setAccountRunNumbers(accountRunNumberMap);
    const bestCombo = statsRows.reduce((max, r) => Math.max(max, r.best_combo ?? 0), 0);
    const bestMoveScore = statsRows.reduce((max, r) => Math.max(max, r.best_move_score ?? 0), 0);
    const bestLinesCleared = statsRows.reduce((max, r) => Math.max(max, r.best_lines_cleared ?? 0), 0);
    const mostMoves = statsRows.reduce((max, r) => Math.max(max, r.move_count ?? 0), 0);
    setAccountStats({
      gamesPlayed: numberingResult.count ?? 0,
      bestScore: topResult.data?.[0]?.score ?? 0,
      bestCombo,
      bestMoveScore,
      bestLinesCleared,
      mostMoves,
      hasLowScore: (lowScoreResult.data?.length ?? 0) > 0,
    });
    accountRunsReadyRef.current = true;
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
      .select("id, user_id, score, created_at, profiles(display_name)")
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
        userId: run.user_id,
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
      .then(async ({ error }) => {
        setRunSubmitting(false);
        if (error) {
          setRunSubmissionError(await getFunctionErrorMessage(error, "Could not save your score. Please check your connection."));
          return;
        }
        loadAccountRuns();
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
    loadGlobalLeaderboard();
  }, []);

  const checkForActiveRun = useEffectEvent(async () => {
    if (!hasSupabaseConfig || !session?.user?.id) return;
    const delays = [800, 2000];
    let lastError = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const { data, error } = await supabase
          .from("runs")
          .select("id, moves")
          .eq("user_id", session.user.id)
          .eq("status", "active")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        setActiveRunDetected(data ? { id: data.id, moveCount: Array.isArray(data.moves) ? data.moves.length : 0 } : null);
        if (!data) {
          clearActiveRunSession();
        }
        setActiveRunCheckFailed(false);
        setActiveRunCheckDone(true);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < delays.length) await sleep(delays[attempt]);
      }
    }
    console.error("Active run check failed after retries.", lastError);
    setActiveRunCheckFailed(true);
    setActiveRunCheckDone(true);
  });

  useEffect(() => {
    if (rankedReady && !started && !activeRunCheckDone) {
      checkForActiveRun();
    }
  }, [rankedReady, started, activeRunCheckDone]);

  useEffect(() => {
    if (!activeRunDetected?.id) {
      autoResumeAttemptedRunIdRef.current = null;
    }
  }, [activeRunDetected?.id]);

  useEffect(() => {
    if (!activeVerifiedRun?.id || !hasSupabaseConfig || !deviceTokenRef.current || game.gameOver) return;
    const runId = activeVerifiedRun.id;

    // Re-verify token immediately after subscribing to catch any race
    void verifyActiveRunDeviceToken(runId);

    const channel = supabase
      .channel(`run-device-${runId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${runId}` },
        async (payload) => {
          const newToken = payload.new?.device_token;
          if (newToken !== undefined) {
            if (deviceTokenRef.current && newToken !== deviceTokenRef.current) setResumedElsewhere(true);
          } else {
            await verifyActiveRunDeviceToken(runId);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeVerifiedRun?.id, game.gameOver]);

  useEffect(() => {
    if (!activeVerifiedRun?.id || !hasSupabaseConfig || game.gameOver) return;
    const runId = activeVerifiedRun.id;

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      void verifyActiveRunDeviceToken(runId);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [activeVerifiedRun?.id, game.gameOver]);

  useEffect(() => {
    if (!activeVerifiedRun?.id || !hasSupabaseConfig || !deviceTokenRef.current || game.gameOver) {
      return;
    }

    const runId = activeVerifiedRun.id;
    const timer = window.setInterval(() => {
      void verifyActiveRunDeviceToken(runId);
    }, RUN_DEVICE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeVerifiedRun?.id, game.gameOver]);

  useEffect(() => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !hasSupabaseConfig || !session?.user?.id) {
    setAccountRecentRuns([]);
    setAccountTopRuns([]);
    setAccountRunNumbers({});
    setAccountStats(null);
      setAccountRunsError("");
      setAccountRunsLoading(false);
      return;
    }

    loadAccountRuns();
  }, [session?.user?.id]);

  useEffect(() => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !hasSupabaseConfig || !session?.user?.id) return;

    let pending;
    try {
      const raw = localStorage.getItem(PENDING_RUN_KEY);
      pending = raw ? JSON.parse(raw) : null;
    } catch {
      return;
    }

    if (!pending?.runId || !Array.isArray(pending.moves)) return;

    if (Date.now() - pending.savedAt > 24 * 60 * 60 * 1000) {
      try { localStorage.removeItem(PENDING_RUN_KEY); } catch {}
      return;
    }

    let cancelled = false;

    (async () => {
      setPendingRunRecoveryPending(true);

      let error = null;

      for (let attempt = 0; attempt <= PENDING_RUN_RECOVERY_RETRY_DELAYS_MS.length; attempt += 1) {
        ({ error } = await supabase.functions.invoke("finish-run", {
          body: {
            runId: pending.runId,
            moves: pending.moves,
            deviceToken: pending.deviceToken ?? null,
          },
        }));

        if (!error || !isRetryableRunConnectionError(error) || attempt === PENDING_RUN_RECOVERY_RETRY_DELAYS_MS.length) {
          break;
        }

        await sleep(PENDING_RUN_RECOVERY_RETRY_DELAYS_MS[attempt]);

        if (cancelled) {
          return;
        }
      }

      if (cancelled) {
        return;
      }

      setPendingRunRecoveryPending(false);

      if (!error) {
        try { localStorage.removeItem(PENDING_RUN_KEY); } catch {}
        setRunSubmissionError("");
        loadAccountRuns();
        loadGlobalLeaderboard();
        return;
      }

      if (error instanceof FunctionsHttpError && error.context?.status === 409) {
        try { localStorage.removeItem(PENDING_RUN_KEY); } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => () => {
    if (moveSyncRetryTimerRef.current) {
      window.clearTimeout(moveSyncRetryTimerRef.current);
      moveSyncRetryTimerRef.current = 0;
    }
    if (nextTrayRetryTimerRef.current) {
      window.clearTimeout(nextTrayRetryTimerRef.current);
      nextTrayRetryTimerRef.current = 0;
    }
  }, []);

  useEffect(() => {
    const pendingRun = activeVerifiedRun;

    if (
      !GLOBAL_LEADERBOARD_ENABLED ||
      !hasSupabaseConfig ||
      !started ||
      game.gameOver ||
      !pendingRun?.id ||
      !deviceTokenRef.current
    ) {
      setMoveSyncReconnectPending(false);
      if (!pendingRun?.id) {
        resetMoveSyncState(moveSyncStateRef);
        if (moveSyncRetryTimerRef.current) {
          window.clearTimeout(moveSyncRetryTimerRef.current);
          moveSyncRetryTimerRef.current = 0;
        }
      }
      return;
    }

    if (runSubmissionInFlightRef.current.has(pendingRun.id)) {
      return;
    }

    if (moveSyncStateRef.current.runId !== pendingRun.id) {
      moveSyncStateRef.current = { runId: pendingRun.id, moveCount: 0 };
    }

    if (
      pendingRun.moves.length === 0 ||
      pendingRun.moves.length <= moveSyncStateRef.current.moveCount ||
      moveSyncInFlightRef.current
    ) {
      return;
    }

    if (moveSyncRetryTimerRef.current) {
      window.clearTimeout(moveSyncRetryTimerRef.current);
      moveSyncRetryTimerRef.current = 0;
    }

    const syncedRunId = pendingRun.id;
    const syncedMoves = pendingRun.moves;
    const syncedDeviceToken = deviceTokenRef.current;
    moveSyncInFlightRef.current = true;

    (async () => {
      let data = null;
      let error = null;

      for (let attempt = 0; attempt <= MOVE_SYNC_RETRY_DELAYS_MS.length; attempt += 1) {
        ({ data, error } = await supabase.functions.invoke("sync-run-move", {
          body: {
            runId: syncedRunId,
            moves: syncedMoves,
            deviceToken: syncedDeviceToken,
          },
        }));

        if (!error || !isRetryableRunConnectionError(error) || attempt === MOVE_SYNC_RETRY_DELAYS_MS.length) {
          break;
        }

        await sleep(MOVE_SYNC_RETRY_DELAYS_MS[attempt]);
      }

      moveSyncInFlightRef.current = false;

      if (error) {
        const latestRun = activeVerifiedRunRef.current;

        if (error instanceof FunctionsHttpError && error.context?.status === 409) {
          const payload = await error.context.json().catch(() => ({}));
          if (payload?.code === "resumed_elsewhere") {
            setMoveSyncReconnectPending(false);
            setResumedElsewhere(true);
            return;
          }
        }

        if (isRetryableRunConnectionError(error)) {
          setMoveSyncReconnectPending(true);

          if (
            activeVerifiedRunRef.current?.id === syncedRunId &&
            !runSubmissionInFlightRef.current.has(syncedRunId)
          ) {
            moveSyncRetryTimerRef.current = window.setTimeout(() => {
              moveSyncRetryTimerRef.current = 0;
              setMoveSyncRetryTick((tick) => tick + 1);
            }, 2500);
          }
          return;
        }

        if (
          latestRun?.id &&
          latestRun.id !== syncedRunId &&
          !runSubmissionInFlightRef.current.has(latestRun.id)
        ) {
          setMoveSyncReconnectPending(false);
          setMoveSyncRetryTick((tick) => tick + 1);
          return;
        }

        setMoveSyncReconnectPending(false);
        setRunReconnectActionRequired("move-sync");
        return;
      }

      setMoveSyncReconnectPending(false);
      const syncedMoveCount = Number.isFinite(Number(data?.moveCount))
        ? Math.max(0, Number(data.moveCount))
        : syncedMoves.length;

      if (moveSyncStateRef.current.runId === syncedRunId) {
        moveSyncStateRef.current = {
          runId: syncedRunId,
          moveCount: Math.max(moveSyncStateRef.current.moveCount, syncedMoveCount),
        };
      }

      const latestRun = activeVerifiedRunRef.current;

      if (
        latestRun?.id &&
        latestRun.id !== syncedRunId &&
        !runSubmissionInFlightRef.current.has(latestRun.id)
      ) {
        setMoveSyncRetryTick((tick) => tick + 1);
        return;
      }

      if (
        latestRun?.id === syncedRunId &&
        latestRun.moves.length > moveSyncStateRef.current.moveCount &&
        !runSubmissionInFlightRef.current.has(syncedRunId)
      ) {
        setMoveSyncRetryTick((tick) => tick + 1);
      }
    })();
  }, [
    activeVerifiedRun,
    game.gameOver,
    moveSyncRetryTick,
    started,
  ]);

  useEffect(() => {
    if (
      !GLOBAL_LEADERBOARD_ENABLED ||
      !hasSupabaseConfig ||
      !started ||
      game.gameOver ||
      !game.awaitingTray ||
      !activeVerifiedRun?.id
    ) {
      setNextTrayReconnectPending(false);
      return;
    }

    if (nextTrayFetchInFlightRef.current) {
      return;
    }

    const pendingRun = activeVerifiedRun;
    if (nextTrayRetryTimerRef.current) {
      window.clearTimeout(nextTrayRetryTimerRef.current);
      nextTrayRetryTimerRef.current = 0;
    }
    nextTrayFetchInFlightRef.current = true;
    setNextTrayPending(true);
    setNextTrayError("");

    let cancelled = false;

    (async () => {
      let data = null;
      let error = null;

      for (let attempt = 0; attempt <= NEXT_TRAY_RETRY_DELAYS_MS.length; attempt += 1) {
        ({ data, error } = await supabase.functions.invoke("next-tray", {
          body: {
            runId: pendingRun.id,
            moves: pendingRun.moves,
            deviceToken: deviceTokenRef.current,
          },
        }));

        if (!error || !isRetryableRunConnectionError(error) || attempt === NEXT_TRAY_RETRY_DELAYS_MS.length) {
          break;
        }

        if (cancelled || activeVerifiedRunRef.current?.id !== pendingRun.id) {
          nextTrayFetchInFlightRef.current = false;
          setNextTrayPending(false);
          return;
        }

        await sleep(NEXT_TRAY_RETRY_DELAYS_MS[attempt]);

        if (cancelled || activeVerifiedRunRef.current?.id !== pendingRun.id) {
          nextTrayFetchInFlightRef.current = false;
          setNextTrayPending(false);
          return;
        }
      }

      if (cancelled) {
        nextTrayFetchInFlightRef.current = false;
        setNextTrayPending(false);
        return;
      }

      nextTrayFetchInFlightRef.current = false;
      setNextTrayPending(false);

      if (error) {
        if (error instanceof FunctionsHttpError && error.context?.status === 409) {
          const payload = await error.context.json().catch(() => ({}));
          if (payload?.code === "resumed_elsewhere") {
            setNextTrayReconnectPending(false);
            setResumedElsewhere(true);
            return;
          }
        }
        if (isRetryableRunConnectionError(error)) {
          setNextTrayReconnectPending(true);
          if (activeVerifiedRunRef.current?.id === pendingRun.id) {
            nextTrayRetryTimerRef.current = window.setTimeout(() => {
              nextTrayRetryTimerRef.current = 0;
              setNextTrayRetryTick((tick) => tick + 1);
            }, 2500);
          }
          return;
        }
        if (activeVerifiedRunRef.current?.id === pendingRun.id) {
          setNextTrayReconnectPending(false);
          setRunReconnectActionRequired("next-tray");
          setNextTrayError(await getFunctionErrorMessage(error, "Could not load the next tray."));
        }
        return;
      }

      if (activeVerifiedRunRef.current?.id !== pendingRun.id) {
        return;
      }

      setNextTrayReconnectPending(false);
      setNextTrayError("");
      setTrayRevealToken((token) => token + 1);
      setGame((current) => (
        current.awaitingTray ? setRankedTray(current, data?.tray ?? []) : current
      ));
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeVerifiedRun,
    game.awaitingTray,
    game.gameOver,
    nextTrayRetryTick,
    started,
  ]);

  useEffect(() => {
    if (!GLOBAL_LEADERBOARD_ENABLED || !hasSupabaseConfig || !game.gameOver || !activeVerifiedRun?.id) {
      return;
    }

    const submittedRun = activeVerifiedRun;

    if (runSubmissionInFlightRef.current.has(submittedRun.id)) {
      return;
    }

    runSubmissionInFlightRef.current.add(submittedRun.id);
    syncRunSubmittingState(runSubmissionInFlightRef.current, setRunSubmitting);
    setMoveSyncReconnectPending(false);
    setNextTrayReconnectPending(false);
    setRunReconnectActionRequired("");
    setRunSubmissionError("");
    storePendingRun(submittedRun.id, submittedRun.moves, deviceTokenRef.current);

    (async () => {
      let error = null;
      const isSubmittedRunStillCurrent = () => activeVerifiedRunRef.current?.id === submittedRun.id;

      for (let attempt = 0; attempt <= FINISH_RUN_RETRY_DELAYS_MS.length; attempt += 1) {
        ({ error } = await supabase.functions.invoke("finish-run", {
          body: {
            runId: submittedRun.id,
            moves: submittedRun.moves,
            deviceToken: deviceTokenRef.current,
          },
        }));

        if (!error || !isRetryableRunConnectionError(error) || attempt === FINISH_RUN_RETRY_DELAYS_MS.length) {
          break;
        }

        await sleep(FINISH_RUN_RETRY_DELAYS_MS[attempt]);
      }

      runSubmissionInFlightRef.current.delete(submittedRun.id);
      syncRunSubmittingState(runSubmissionInFlightRef.current, setRunSubmitting);

      if (error) {
        if (error instanceof FunctionsHttpError && error.context?.status === 409) {
          const payload = await error.context.json().catch(() => ({}));
          if (payload?.code === "resumed_elsewhere") {
            if (isSubmittedRunStillCurrent()) {
              setResumedElsewhere(true);
            }
            return;
          }
        }

        if (error instanceof FunctionsHttpError && error.context?.status === 401) {
          if (isSubmittedRunStillCurrent()) {
            resetClientSessionState();
            setAuthError("Your session expired. Your score is saved. Sign in to submit it.");
            setRunSubmissionError("Session expired. Your score is saved. Sign in, then tap to retry.");
            handleOpenAuthPrompt();
          }
          return;
        }

        if (isSubmittedRunStillCurrent()) {
          setRunSubmissionError(await getFunctionErrorMessage(error, "Could not submit this score. Tap to retry."));
        }
        return;
      }

      clearPendingRun(submittedRun.id);
      clearActiveRunSession(submittedRun.id);
      if (isSubmittedRunStillCurrent()) {
        resetRunRecoveryState();
      }
      setActiveVerifiedRun((current) => (current?.id === submittedRun.id ? null : current));
      loadAccountRuns();
      loadGlobalLeaderboard();
    })();
  }, [
    activeVerifiedRun,
    game.gameOver,
    leaderboardOpen,
    leaderboardTab,
    finishRunAttempt,
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
        resetClientSessionState();
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
      setProfileLoading(false);
      setDisplayNameDraft("");
      setEditingProfile(false);
      setActiveTheme((current) => {
        const nextTheme = FREE_THEME_KEYS.has(current) || (devThemeUnlocked && current === "dev")
          ? current
          : "classic";
        try { localStorage.setItem("gridpop-theme", nextTheme); } catch {}
        return nextTheme;
      });
      return;
    }

    let alive = true;
    setProfileLoading(true);

    async function loadProfile() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, theme, has_shared_stats, dev_theme_unlocked")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!alive) {
        return;
      }

      if (error) {
        setAuthError(error.message);
        setProfileLoading(false);
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
      setProfileLoading(false);
      if (nextProfile?.theme) {
        setActiveTheme(nextProfile.theme);
        localStorage.setItem("gridpop-theme", nextProfile.theme);
      }
    }

    loadProfile();

    return () => {
      alive = false;
    };
  }, [devThemeUnlocked, session?.user?.id]);

  useEffect(() => {
    if (!game.gameOver) {
      return;
    }

    navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});

    setLocalRuns(recordRunScore(game.score, {
      bestCombo: game.bestCombo,
      bestMoveScore: game.bestMoveScore,
      bestLinesCleared: game.bestLinesCleared,
      moveCount: game.moveCount,
    }));
    if (!activeVerifiedRun) {
      autoSubmitGuestRun(game.score);
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
    if (gameOverPhase !== 'overlay') {
      setDisplayedScore(0);
      setScoreFinished(false);
      setStatsRevealed(0);
      setShowPlayAgain(false);
      setShowNewBestBanner(false);
      return;
    }

    const target = game.score;
    const prevBest = prevBestScoreRef.current;
    const newBestThreshold = prevBest > 0 ? prevBest : target;
    const DURATION = 1200;
    const startTime = performance.now();
    let newBestFired = false;
    let rafId;
    const timerIds = [];

    function easeOut(t) { return 1 - (1 - t) ** 3; }

    function onCountDone() {
      setScoreFinished(true);
      if (isNewBest && !newBestFired) setShowNewBestBanner(true);
      timerIds.push(
        setTimeout(() => setStatsRevealed(1), 100),
        setTimeout(() => setStatsRevealed(2), 230),
        setTimeout(() => setStatsRevealed(3), 360),
        setTimeout(() => setShowPlayAgain(true), 620),
      );
    }

    if (target === 0) {
      setDisplayedScore(0);
      if (isNewBest) setShowNewBestBanner(true);
      onCountDone();
      return () => { timerIds.forEach(clearTimeout); };
    }

    function countUp(now) {
      const t = Math.min((now - startTime) / DURATION, 1);
      const value = Math.round(easeOut(t) * target);
      setDisplayedScore(value);

      if (isNewBest && !newBestFired && value >= newBestThreshold) {
        newBestFired = true;
        setShowNewBestBanner(true);
      }

      if (t < 1) {
        rafId = requestAnimationFrame(countUp);
      } else {
        onCountDone();
      }
    }

    rafId = requestAnimationFrame(countUp);

    return () => {
      cancelAnimationFrame(rafId);
      timerIds.forEach(clearTimeout);
    };
  }, [gameOverPhase, game.score, isNewBest]);

  useEffect(() => {
    if (game.cleared.length === 0) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setGame((current) => clearClearedCells(current));
    }, 480);

    return () => window.clearTimeout(timer);
  }, [game.cleared]);

  const unlockedThemes = getUnlockedThemes(accountStats, profile, globalRuns, session?.user?.id, devThemeUnlocked);
  const unlockNotifiableThemeKeys = [...unlockedThemes].filter((key) => !FREE_THEME_KEYS.has(key));
  const hasUnreadChangelog = lastSeenVersion !== CLIENT_VERSION;
  const hasUnreadThemes = seenThemeUnlocks !== null && unlockNotifiableThemeKeys.some((key) => !seenThemeUnlocks.has(key));

  useEffect(() => {
    if (seenThemeUnlocks !== null) {
      return;
    }

    const baselineSeen = new Set(unlockNotifiableThemeKeys);
    setSeenThemeUnlocks(baselineSeen);
    try {
      localStorage.setItem(SEEN_THEME_UNLOCKS_STORAGE_KEY, JSON.stringify([...baselineSeen]));
    } catch {}
  }, [seenThemeUnlocks, unlockNotifiableThemeKeys]);

  useEffect(() => {
    if (!showThemeModal || seenThemeUnlocks === null) {
      return;
    }

    let changed = false;
    const nextSeen = new Set(seenThemeUnlocks);
    for (const key of unlockNotifiableThemeKeys) {
      if (nextSeen.has(key)) {
        continue;
      }

      nextSeen.add(key);
      changed = true;
    }

    if (!changed) {
      return;
    }

    setSeenThemeUnlocks(nextSeen);
    try {
      localStorage.setItem(SEEN_THEME_UNLOCKS_STORAGE_KEY, JSON.stringify([...nextSeen]));
    } catch {}
  }, [seenThemeUnlocks, showThemeModal, unlockNotifiableThemeKeys]);

  useEffect(() => {
    if (!showChangelog || lastSeenVersion === CLIENT_VERSION) {
      return;
    }

    setLastSeenVersion(CLIENT_VERSION);
    try {
      localStorage.setItem(LAST_SEEN_VERSION_STORAGE_KEY, CLIENT_VERSION);
    } catch {}
  }, [lastSeenVersion, showChangelog]);

  useEffect(() => {
    // Don't enforce theme restrictions before account stats are ready — avoids revoking
    // a profile theme due to a race where stats haven't loaded yet to confirm the unlock.
    if (profile !== null && accountStats === null) return;
    // Don't revoke conditional themes (top10/rank1) before leaderboard data is loaded;
    // the auto-revoke effect handles those once globalRuns arrives.
    const activeThemeObj = THEMES.find((t) => t.key === activeTheme);
    if (activeThemeObj?.condition && globalRuns.length === 0) return;

    const nextTheme = getAllowedThemeKey(activeTheme, unlockedThemes);

    if (nextTheme === activeTheme) {
      return;
    }

    setActiveTheme(nextTheme);
    try { localStorage.setItem("gridpop-theme", nextTheme); } catch {}
  }, [activeTheme, unlockedThemes]);

  // Auto-revoke conditional themes when fresh global data shows the condition is no longer met
  useEffect(() => {
    if (!globalRuns.length) return;
    const activeThemeObj = THEMES.find((t) => t.key === activeTheme);
    if (!activeThemeObj?.condition) return;
    const userId = session?.user?.id;
    const stillAvailable = userId && (
      activeThemeObj.condition === "top10"
        ? globalRuns.some((r) => r.userId === userId)
        : activeThemeObj.condition === "rank1"
          ? globalRuns[0]?.userId === userId
          : false
    );
    if (!stillAvailable) {
      setActiveTheme("classic");
      try { localStorage.setItem("gridpop-theme", "classic"); } catch {}
      if (hasSupabaseConfig && userId) {
        supabase.from("profiles").update({ theme: "classic" }).eq("id", userId);
      }
    }
  }, [globalRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  const aggregateStats = accountStats ? {
    gamesPlayed: accountStats.gamesPlayed,
    bestScore: accountStats.bestScore,
    bestCombo: accountStats.bestCombo,
    bestMoveScore: accountStats.bestMoveScore,
    bestLinesCleared: accountStats.bestLinesCleared,
    mostMoves: accountStats.mostMoves,
  } : null;

  function recordVerifiedMove(pieceId, row, col) {
    setActiveVerifiedRun((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        moves: [...current.moves, { pieceId, row, col }],
      };
    });
  }

  useEffect(() => {
    if (activeVerifiedRun?.id && deviceTokenRef.current) {
      storeActiveRunSession(
        activeVerifiedRun.id,
        activeVerifiedRun.moves,
        deviceTokenRef.current,
        prevBestScoreRef.current,
      );
    }
  }, [activeVerifiedRun]);

  const runPreviewAtPoint = useEffectEvent((clientX, clientY, activeDrag = null) => {
    if (!started || game.gameOver) {
      return;
    }

    const pieceId = activeDrag?.pieceId ?? game.selectedPieceId;
    const piece = findPiece(game.tray, pieceId);
    const boardElement = boardRef.current;

    if (!piece || !boardElement) {
      return;
    }

    // If pointer is over the dismiss zone, clear the board preview and bail out early.
    // This prevents the lifted ghost from accidentally showing a valid board placement
    // when the player is dragging back toward the tray.
    const dismissZone = dismissZoneRef.current;
    if (dismissZone) {
      const zoneRect = dismissZone.getBoundingClientRect();
      const isOverZone = clientX >= zoneRect.left && clientX <= zoneRect.right &&
                         clientY >= zoneRect.top  && clientY <= zoneRect.bottom;
      dismissZone.classList.toggle("is-hovered", isOverZone);
      if (isOverZone) {
        previewSoundRef.current.key = null;
        if (livePreviewRef.current !== null) {
          livePreviewRef.current = null;
          startTransition(() => setGame((current) => clearPreview(current)));
        }
        return;
      }
    }

    const metrics = activeDrag ? (dragBoardMetricsRef.current ?? getBoardCellMetrics(boardElement)) : getBoardCellMetrics(boardElement);

    if (!metrics) {
      return;
    }

    const { ghostBounds, row: rawRow, col: rawCol } = getSnappedPlacement(metrics, piece, clientX, clientY);
    const slopPx = metrics.stepPx * DROP_SNAP_SLOP_CELLS;

    if (
      ghostBounds.right < metrics.gridLeft - slopPx ||
      ghostBounds.left > metrics.gridRight + slopPx ||
      ghostBounds.bottom < metrics.gridTop - slopPx ||
      ghostBounds.top > metrics.gridBottom + slopPx
    ) {
      previewSoundRef.current.key = null;
      if (livePreviewRef.current !== null) {
        livePreviewRef.current = null;
        startTransition(() => {
          setGame((current) => clearPreview(current));
        });
      }
      return;
    }

    // Apply stickiness hysteresis: only move to a new cell once the raw position
    // has travelled far enough past the boundary from the last snapped position.
    let row = rawRow;
    let col = rawCol;
    const stickiness = gridStickinessRef.current;
    if (stickiness > 0 && livePreviewRef.current) {
      const lastRow = livePreviewRef.current.row;
      const lastCol = livePreviewRef.current.col;
      const rawColF = (ghostBounds.left - metrics.gridLeft) / metrics.stepX;
      const rawRowF = (ghostBounds.top  - metrics.gridTop)  / metrics.stepY;
      const threshold = 0.5 + stickiness * 0.45;
      if (Math.abs(rawColF - lastCol) < threshold) col = Math.max(0, Math.min(GRID_SIZE - piece.bounds.width, lastCol));
      if (Math.abs(rawRowF - lastRow) < threshold) row = Math.max(0, Math.min(GRID_SIZE - piece.bounds.height, lastRow));
    }

    const preview = buildPreview(game.board, piece, row, col);

    if (matchesPreview(livePreviewRef.current, preview)) {
      return;
    }

    const previewKey = `${preview.pieceId}:${preview.row}:${preview.col}:${preview.valid ? 1 : 0}`;
    const now = performance.now();

    if (
      previewSoundRef.current.key !== previewKey &&
      now - previewSoundRef.current.at > 26
    ) {
      playPreviewMoveSound();
      previewSoundRef.current = { key: previewKey, at: now };
    }

    livePreviewRef.current = preview;
    startTransition(() => {
      setGame((current) => setPreview(current, preview));
    });
  });

  const queuePreviewFromPoint = useEffectEvent((clientX, clientY, activeDrag = null) => {
    queuedPreviewRef.current = { clientX, clientY, activeDrag };

    if (previewFrameRef.current) {
      return;
    }

    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = 0;
      const nextPreview = queuedPreviewRef.current;
      queuedPreviewRef.current = null;

      if (!nextPreview) {
        return;
      }

      runPreviewAtPoint(nextPreview.clientX, nextPreview.clientY, nextPreview.activeDrag);
    });
  });

  const cancelQueuedPreview = useEffectEvent(() => {
    if (previewFrameRef.current) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = 0;
    }

    queuedPreviewRef.current = null;
  });

  useEffect(() => {
    if (!runInteractionLocked || !drag) {
      return;
    }

    pickupSoundPlayedRef.current = false;
    previewSoundRef.current.key = null;
    dismissZoneRef.current?.classList.remove("is-hovered");
    cancelQueuedPreview();
    setDrag(null);
    dragBoardMetricsRef.current = null;
    livePreviewRef.current = null;
    setGame((current) => ({ ...clearPreview(current), selectedPieceId: null }));
  }, [cancelQueuedPreview, drag, runInteractionLocked]);

  const handleWindowPointerMove = useEffectEvent((event) => {
    if (runInteractionLocked) {
      return;
    }

    if (drag) {
      let dragArmed = drag.armed;
      if (!dragArmed) {
        const intent = dragIntentRef.current;
        const dx = event.clientX - (intent?.startX ?? event.clientX);
        const dy = event.clientY - (intent?.startY ?? event.clientY);
        const slop = intent?.pointerType === "mouse" ? 10 : TRAY_DRAG_START_SLOP_PX;

        if (dx * dx + dy * dy <= slop * slop) {
          return;
        }

        dragArmed = true;
        trayDragClickSuppressRef.current = true;
        if (intent) {
          dragIntentRef.current = { ...intent, armed: true };
        }

        setGame((current) => (
          current.selectedPieceId === drag.pieceId
            ? current
            : {
                ...current,
                selectedPieceId: drag.pieceId,
              }
        ));
        setDrag((current) => (
          current?.pieceId === drag.pieceId
            ? { ...current, armed: true }
            : current
        ));
      }

      if (!pickupSoundPlayedRef.current) {
        primeSound();
        playPickupSound();
        pickupSoundPlayedRef.current = true;
      }

      dragPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
      };

      if (dragGhostRef.current) {
        let ghostX = event.clientX;
        let ghostY = event.clientY;
        const stickiness = gridStickinessRef.current;
        if (stickiness > 0 && livePreviewRef.current && dragBoardMetricsRef.current) {
          const metrics = dragBoardMetricsRef.current;
          const { row, col } = livePreviewRef.current;
          // Use the ghost element's actual rendered dimensions so the snap target
          // is derived from the same pixel values that the CSS transform uses for
          // translate(-50%, -100% - LIFT). Any rem-rounding difference between
          // the ghost cells and the board cells would otherwise cause vertical drift.
          const ghostRect = dragGhostRef.current.getBoundingClientRect();
          const liftPx = DRAG_GHOST_LIFT_REM * metrics.rootFontSize;
          const snappedX = metrics.gridLeft + col * metrics.stepX + ghostRect.width / 2;
          const snappedY = metrics.gridTop  + row * metrics.stepY + ghostRect.height + liftPx;
          ghostX = event.clientX + stickiness * (snappedX - event.clientX);
          ghostY = event.clientY + stickiness * (snappedY - event.clientY);
        }
        dragGhostRef.current.style.transform = getGhostTransform(ghostX, ghostY);
      }

      queuePreviewFromPoint(event.clientX, event.clientY, drag);
    }
  });

  const handleWindowPointerUp = useEffectEvent((event) => {
    if (runInteractionLocked) {
      return;
    }

    if (!drag) {
      return;
    }

    pickupSoundPlayedRef.current = false;
    previewSoundRef.current.key = null;
    dismissZoneRef.current?.classList.remove("is-hovered");
    cancelQueuedPreview();

    const dragArmed = drag.armed || dragIntentRef.current?.armed;
    dragIntentRef.current = null;
    if (!dragArmed) {
      setDrag(null);
      dragBoardMetricsRef.current = null;
      livePreviewRef.current = null;
      return;
    }

    runPreviewAtPoint(event.clientX, event.clientY, drag);
    const pieceId = drag.pieceId;
    const preview = livePreviewRef.current;
    setDrag(null);
    dragBoardMetricsRef.current = null;
    livePreviewRef.current = null;
    window.setTimeout(() => {
      trayDragClickSuppressRef.current = false;
    }, 0);

    if (preview?.valid && preview.pieceId === pieceId) {
      if (confirmPlacementRef.current) {
        // Lock the preview — player must tap the board to confirm placement
        setLockedPreview(preview);
        startTransition(() => setGame((current) => setPreview(current, preview)));
        return;
      }

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

    setGame((current) => ({ ...clearPreview(current), selectedPieceId: null }));
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

  useEffect(() => () => {
    if (previewFrameRef.current) {
      window.cancelAnimationFrame(previewFrameRef.current);
    }
  }, []);

  // Compute the SVG outline path for the locked preview using actual measured cell
  // positions — avoids all CSS formula errors by reading directly from the DOM.
  useLayoutEffect(() => {
    if (!lockedPreview?.valid || !boardRef.current) {
      setLockedPreviewPath(null);
      return;
    }

    const piece = findPiece(game.tray, lockedPreview.pieceId);
    if (!piece) {
      setLockedPreviewPath(null);
      return;
    }

    const boardEl = boardRef.current;
    const allCells = boardEl.querySelectorAll('.board-cell');
    if (allCells.length < GRID_SIZE + 1) {
      setLockedPreviewPath(null);
      return;
    }

    // Measure the actual rendered positions of two reference cells to get exact
    // origin, step, and cell size — no formula, no float accumulation.
    const boardRect = boardEl.getBoundingClientRect();
    // SVG origin = board's padding edge = inside the border
    const svgOriginX = boardRect.left + boardEl.clientLeft;
    const svgOriginY = boardRect.top  + boardEl.clientTop;

    const r0 = allCells[0].getBoundingClientRect();             // cell (row=0, col=0)
    const r1 = allCells[1].getBoundingClientRect();             // cell (row=0, col=1)
    const r8 = allCells[GRID_SIZE].getBoundingClientRect();     // cell (row=1, col=0)

    const originX = r0.left - svgOriginX;   // paddingLeft in SVG space
    const originY = r0.top  - svgOriginY;   // paddingTop  in SVG space
    const stepX   = r1.left - r0.left;      // cellSize + gapX
    const stepY   = r8.top  - r0.top;       // cellSize + gapY
    const cellW   = r0.width;
    const halfGapX = (stepX - cellW) / 2;
    const halfGapY = (stepY - r0.height) / 2;
    const R  = cellW * 0.28;
    const RgX = R / stepX;
    const RgY = R / stepY;

    const vx = (gx) => originX + gx * stepX - halfGapX;
    const vy = (gy) => originY + gy * stepY - halfGapY;

    // Build occupied set
    const occupied = new Set();
    for (const [dx, dy] of piece.shape.cells) {
      occupied.add(`${lockedPreview.row + dy},${lockedPreview.col + dx}`);
    }
    const has = (r, c) => occupied.has(`${r},${c}`);

    // Directed exterior edges (CW traversal)
    const adj = new Map();
    const addEdge = (from, to) => adj.set(`${from[0]},${from[1]}`, { from, to });
    for (const key of occupied) {
      const [r, c] = key.split(',').map(Number);
      if (!has(r - 1, c)) addEdge([c, r],     [c + 1, r]);
      if (!has(r, c + 1)) addEdge([c + 1, r], [c + 1, r + 1]);
      if (!has(r + 1, c)) addEdge([c + 1, r + 1], [c, r + 1]);
      if (!has(r, c - 1)) addEdge([c, r + 1], [c, r]);
    }

    // Walk closed loops
    const visited = new Set();
    const loops = [];
    for (const [startKey] of adj) {
      if (visited.has(startKey)) continue;
      const loop = [];
      let curKey = startKey;
      while (!visited.has(curKey) && adj.has(curKey)) {
        visited.add(curKey);
        const { from, to } = adj.get(curKey);
        loop.push(from);
        curKey = `${to[0]},${to[1]}`;
      }
      if (loop.length >= 3) loops.push(loop);
    }

    // Build SVG path with rounded convex corners
    let d = '';
    for (const loop of loops) {
      const n = loop.length;
      const verts = loop.map((v, i) => {
        const prev = loop[(i - 1 + n) % n];
        const next = loop[(i + 1) % n];
        const inDx = v[0] - prev[0], inDy = v[1] - prev[1];
        const outDx = next[0] - v[0], outDy = next[1] - v[1];
        const cross = inDx * outDy - inDy * outDx;
        return { v, inDx, inDy, outDx, outDy, convex: cross > 0 };
      });

      const last = verts[n - 1];
      const sx = last.convex ? vx(last.v[0] + last.outDx * RgX) : vx(last.v[0]);
      const sy = last.convex ? vy(last.v[1] + last.outDy * RgY) : vy(last.v[1]);
      d += `M ${sx} ${sy} `;

      for (const { v, inDx, inDy, outDx, outDy, convex } of verts) {
        if (convex) {
          const ax = vx(v[0] - inDx * RgX), ay = vy(v[1] - inDy * RgY);
          const dpx = vx(v[0] + outDx * RgX), dpy = vy(v[1] + outDy * RgY);
          d += `L ${ax} ${ay} A ${R} ${R} 0 0 1 ${dpx} ${dpy} `;
        } else {
          d += `L ${vx(v[0])} ${vy(v[1])} `;
        }
      }
      d += 'Z ';
    }

    setLockedPreviewPath(d.trim() || null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedPreview]);

  function startLocalGame() {
    setStartFailed(false);
    nextTrayFetchInFlightRef.current = false;
    moveSyncInFlightRef.current = false;
    resetMoveSyncState(moveSyncStateRef);
    setNextTrayPending(false);
    resetRunRecoveryState();
    setNextTrayRetryTick(0);
    setMoveSyncRetryTick(0);
    setTrayRevealToken(0);
    setGame(createGameState(displayedBestScore));
    setStarted(true);
    if (soundEnabled) unlockAndTestSound();
  }

  function applyResumedRunState(data, options = {}) {
    const { clearStartOverlay = false, bestScoreBaseline = null } = options;
    deviceTokenRef.current = data.deviceToken ?? null;
    moveSyncInFlightRef.current = false;
    moveSyncStateRef.current = {
      runId: data.runId ?? null,
      moveCount: Array.isArray(data.moves) ? data.moves.length : 0,
    };
    if (moveSyncRetryTimerRef.current) {
      window.clearTimeout(moveSyncRetryTimerRef.current);
      moveSyncRetryTimerRef.current = 0;
    }
    const baseState = createGameState(displayedBestScore, { ranked: true, tray: data.tray });
    setGameOverPhase(null);
    setFillCells([]);
    setIsNewBest(false);
    setRunSubmitting(false);
    setRunSubmissionError("");
    setNextTrayPending(false);
    resetRunRecoveryState();
    setNextTrayRetryTick(0);
    setMoveSyncRetryTick(0);
    setFinishRunAttempt(0);
    setActiveVerifiedRun(null);
    nextTrayFetchInFlightRef.current = false;
    prevBestScoreRef.current = Math.max(
      Number.isFinite(Number(bestScoreBaseline)) ? Math.max(0, Number(bestScoreBaseline)) : 0,
      displayedBestScore,
    );
    setGame({
      ...baseState,
      board: data.board,
      score: data.score ?? 0,
      bestScore: data.bestScore ?? baseState.bestScore,
      moveCount: data.moveCount ?? 0,
      bestCombo: data.bestCombo ?? 0,
      bestMoveScore: data.bestMoveScore ?? 0,
      bestLinesCleared: data.bestLinesCleared ?? 0,
      combo: data.combo ?? 0,
      cleared: [],
      clearedTones: {},
    });
    setActiveVerifiedRun({ id: data.runId, moves: data.moves ?? [] });
    if (data.runId && data.deviceToken) {
      storeActiveRunSession(
        data.runId,
        data.moves ?? [],
        data.deviceToken,
        prevBestScoreRef.current,
      );
    }
    if (clearStartOverlay) {
      setActiveRunDetected(null);
    }
    setResumeFailed("");
    setResumedElsewhere(false);
    setTrayRevealToken((token) => token + 1);
    if (clearStartOverlay) {
      setStarted(true);
    }
    if (soundEnabled) unlockAndTestSound();
  }

  async function beginNextGame(confirmAbandon = false) {
    if (hasSupabaseConfig && !authReady) {
      return;
    }

    if (session?.user?.id && profileLoading) {
      return;
    }

    if (session?.user?.id && !accountRunsReadyRef.current) {
      return;
    }

    if (session?.user?.id && !profile?.display_name) {
      setAuthError("Set a display name before starting.");
      handleOpenAuthPrompt();
      return;
    }

    prevBestScoreRef.current = displayedBestScore;
    setGameOverPhase(null);
    setFillCells([]);
    setIsNewBest(false);
    setLockedPreview(null);
    setRunSubmitting(false);
    setRunSubmissionError("");
    setNextTrayPending(false);
    setNextTrayError("");
    setNextTrayRetryTick(0);
    setTrayRevealToken(0);
    setFinishRunAttempt(0);
    setActiveVerifiedRun(null);
    setActiveRunDetected(null);
    setActiveRunCheckDone(false);
    setActiveRunCheckFailed(false);
    setResumedElsewhere(false);
    setResumeFailed("");
    setResumeRunGone(false);
    deviceTokenRef.current = null;
    setStartFailed(false);
    setStarted(false);
    nextTrayFetchInFlightRef.current = false;
    moveSyncInFlightRef.current = false;
    resetMoveSyncState(moveSyncStateRef);
    resetRunRecoveryState();
    setMoveSyncRetryTick(0);
    clearActiveRunSession();
    setGame(createGameState(displayedBestScore));

    if (!rankedReady) {
      startLocalGame();
      return;
    }

    setStartPending(true);

    let data = null;
    let error = null;

    for (let attempt = 0; attempt <= START_RUN_RETRY_DELAYS_MS.length; attempt += 1) {
      ({ data, error } = await supabase.functions.invoke("start-run", {
        body: { clientVersion: CLIENT_VERSION, ...(confirmAbandon ? { confirmAbandon: true } : {}) },
      }));

      if (!error && data?.runId && Array.isArray(data?.tray)) {
        break;
      }

      if (!isRetryableRunConnectionError(error) || attempt === START_RUN_RETRY_DELAYS_MS.length) {
        break;
      }

      await sleep(START_RUN_RETRY_DELAYS_MS[attempt]);
    }

    setStartPending(false);

    if (!error && data?.runId && Array.isArray(data?.tray)) {
      deviceTokenRef.current = data.deviceToken ?? null;
      moveSyncStateRef.current = { runId: data.runId, moveCount: 0 };
      if (data.deviceToken) {
        storeActiveRunSession(data.runId, [], data.deviceToken, prevBestScoreRef.current);
      }
      setTrayRevealToken((token) => token + 1);
      setGame(createGameState(displayedBestScore, { ranked: true, tray: data.tray }));
      setActiveVerifiedRun({ id: data.runId, moves: [] });
      setStarted(true);
      if (soundEnabled) unlockAndTestSound();
      return;
    }

    if (error instanceof FunctionsHttpError && error.context?.status === 409) {
      const payload = await error.context.json().catch(() => ({}));
      if (payload?.code === "active_run_exists") {
        setActiveRunDetected({ id: payload.runId ?? null, moveCount: payload.moveCount ?? 0 });
        setActiveRunCheckDone(true);
        return;
      }
    }

    if (error instanceof FunctionsHttpError && error.context?.status === 401) {
      resetClientSessionState();
      setAuthError("Your session expired. Sign in again.");
      handleOpenAuthPrompt();
      return;
    }

    setStartFailed(true);
  }

  function handleStartGame() {
    beginNextGame();
  }

  function handleNewGame() {
    beginNextGame(true);
  }

  const resumeRun = useEffectEvent(async ({ reclaim = false, preferredSession = null, clearStartOverlay = true } = {}) => {
    setResumePending(true);
    setResumeFailed("");
    setRunReconnectActionRequired("");
    setMoveSyncReconnectPending(false);
    setNextTrayReconnectPending(false);
    if (reclaim) {
      setResumeRunGone(false);
    }

    async function invokeResume(sessionOverride) {
      const retryDelaysMs = reclaim ? [800] : [600, 1500];
      let data = null;
      let error = null;

      for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
        ({ data, error } = await supabase.functions.invoke("resume-run", {
          body: sessionOverride
            ? {
                runId: sessionOverride.runId,
                deviceToken: sessionOverride.deviceToken,
                moves: sessionOverride.moves,
              }
            : {},
        }));
        if (!error || !isRetryableRunConnectionError(error) || attempt === retryDelaysMs.length) {
          break;
        }
        await sleep(retryDelaysMs[attempt]);
      }

      return { data, error };
    }

    let { data, error } = await invokeResume(preferredSession);

    if (
      error instanceof FunctionsHttpError &&
      preferredSession &&
      (error.context?.status === 404 || error.context?.status === 409)
    ) {
      clearActiveRunSession(preferredSession.runId);
      ({ data, error } = await invokeResume(null));
    }

    setResumePending(false);

    if (error) {
      if (error instanceof FunctionsHttpError && error.context?.status === 401) {
        resetClientSessionState();
        setAuthError("Your session expired. Your game is saved. Sign in to continue.");
        handleOpenAuthPrompt();
        return;
      }
      if (error instanceof FunctionsHttpError && (error.context?.status === 404 || error.context?.status === 409)) {
        clearActiveRunSession(preferredSession?.runId ?? activeRunDetected?.id ?? null);
        setResumeFailed("Run cannot be found.");
        if (!clearStartOverlay) {
          setRunReconnectActionRequired("resume-gone");
        }
        if (reclaim) {
          setResumeRunGone(true);
        } else {
          setActiveRunDetected(null);
        }
        return;
      }
      if (!clearStartOverlay) {
        setRunReconnectActionRequired("resume");
      }
      setResumeFailed(reclaim ? "Couldn't reclaim that run right now. Try again." : "Couldn't reach your run. Try again.");
      return;
    }

    if (data?.gameEnded) {
      clearActiveRunSession(preferredSession?.runId ?? data?.runId ?? activeRunDetected?.id ?? null);
      setResumeFailed("Your last game has ended. Your score has been saved!");
      if (reclaim) {
        setResumeRunGone(true);
      } else {
        setActiveRunDetected(null);
      }
      loadAccountRuns();
      loadGlobalLeaderboard();
      return;
    }

    applyResumedRunState(data, {
      clearStartOverlay,
      bestScoreBaseline: preferredSession?.bestScoreBaseline,
    });
  });

  function handleContinueGame() {
    const preferredSession = activeRunDetected?.id ? loadActiveRunSession(activeRunDetected.id) : null;
    void resumeRun({ preferredSession, clearStartOverlay: true });
  }

  function handleReconnectRun() {
    const preferredSession = activeVerifiedRun?.id ? loadActiveRunSession(activeVerifiedRun.id) : null;
    setRunReconnectActionRequired("");
    void resumeRun({ preferredSession, clearStartOverlay: false });
  }

  function handleResumeHere() {
    void resumeRun({ reclaim: true, clearStartOverlay: false });
  }

  function handleStartFresh() {
    handleNewGame();
  }

  function handleRestart() {
    if (runSubmitting) {
      return;
    }
    if (fillIntervalRef.current) {
      clearInterval(fillIntervalRef.current);
      fillIntervalRef.current = null;
    }
    beginNextGame();
  }

  function handleVolumeChange(value) {
    const v = Math.max(0, Math.min(1, value));
    if (v > 0) lastNonZeroVolumeRef.current = v;
    setSoundVolumeState(v);
    setSoundVolume(v);
    try { localStorage.setItem("gridpop-volume", String(v)); } catch {}
    // Throttled crackle on slider drag — same sound as dragging a piece over the grid
    const now = Date.now();
    if (now - sliderSoundThrottleRef.current > 80) {
      sliderSoundThrottleRef.current = now;
      primeSound();
      playPreviewMoveSound();
    }
  }

  function handleStickinessChange(value) {
    const v = Math.max(0, Math.min(1, value));
    gridStickinessRef.current = v;
    setGridStickiness(v);
    try { localStorage.setItem("gridpop-stickiness", String(v)); } catch {}
    primeSound();
    playPlaceSound();
  }

  function handleShowAccessibleThemesChange(checked) {
    setShowAccessibleThemes(checked);
    try { localStorage.setItem("gridpop-show-accessible", String(checked)); } catch {}
    primeSound();
    playPlaceSound();
  }

  function handleCrtFilterLevelChange(value) {
    const nextLevel = CRT_FILTER_LEVELS.some((level) => level.value === value) ? value : "off";
    setCrtFilterLevel(nextLevel);
    try { localStorage.setItem("gridpop-crt-filter", nextLevel); } catch {}
    primeSound();
    playPlaceSound();
  }

  function handleConfirmPlacementChange(checked) {
    confirmPlacementRef.current = checked;
    setConfirmPlacement(checked);
    if (!checked) {
      setLockedPreview(null);
      setGame((current) => clearPreview(current));
    }
    try { localStorage.setItem("gridpop-confirm-placement", String(checked)); } catch {}
    primeSound();
    playPlaceSound();
  }

  function handleToggleSound() {
    const isMuted = !soundEnabled || soundVolume === 0;
    if (isMuted) {
      const restoreVolume = lastNonZeroVolumeRef.current;
      setSoundEnabled(true);
      setSoundEnabledState(true);
      handleVolumeChange(restoreVolume);
      unlockAndTestSound();
    } else {
      setSoundEnabled(false);
      setSoundEnabledState(false);
    }
  }

  function handleSelectPiece(pieceId) {
    if (trayDragClickSuppressRef.current) {
      trayDragClickSuppressRef.current = false;
      return;
    }

    if (!started || drag || runInteractionLocked) {
      return;
    }

    if (lockedPreview) {
      setLockedPreview(null);
      setGame((current) => clearPreview(current));
    }

    primeSound();
    playPickupSound();
    setGame((current) => togglePieceSelection(current, pieceId));
  }

  function handleStartDrag(piece, event) {
    if (!started || game.gameOver || runInteractionLocked) {
      return;
    }

    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    if (lockedPreview) {
      setLockedPreview(null);
      setGame((current) => clearPreview(current));
    }

    pickupSoundPlayedRef.current = false;
    dragPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    dragIntentRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      pointerType: event.pointerType,
      armed: false,
    };
    dragBoardMetricsRef.current = getBoardCellMetrics(boardRef.current);

    const nextDrag = {
      pieceId: piece.id,
      armed: false,
    };

    previewSoundRef.current.key = null;
    setDrag(nextDrag);
  }

  // Deferred drag start for locked-preview cells — only initiates drag once the
  // pointer has moved beyond SLOP pixels, so a tap-to-confirm doesn't accidentally
  // lift and mis-place the piece due to touch jitter.
  function handleLockedPreviewPointerDown(piece, event) {
    const SLOP = 8;
    const startX = event.clientX;
    const startY = event.clientY;

    function onMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (dx * dx + dy * dy > SLOP * SLOP) {
        cleanup();
        lockedDragStartedRef.current = true;
        // Use original touch position so ghost aligns with where the finger landed,
        // not the slop-threshold point (which is 8px off).
        handleStartDrag(piece, { clientX: startX, clientY: startY, preventDefault() {} });
      }
    }

    function onUp() {
      cleanup();
    }

    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function handleBoardMove(event) {
    if (!started || !game.selectedPieceId || drag || game.gameOver || runInteractionLocked) {
      return;
    }

    queuePreviewFromPoint(event.clientX, event.clientY);
  }

  function handleBoardLeave() {
    if (!started || drag || runInteractionLocked) {
      return;
    }

    cancelQueuedPreview();
    previewSoundRef.current.key = null;
    livePreviewRef.current = null;
    setGame((current) => clearPreview(current));
  }

  function handleCellClick(row, col) {
    if (!started || game.gameOver || runInteractionLocked) {
      return;
    }

    // Click fired after a locked-preview drag started — ignore it
    if (lockedDragStartedRef.current) {
      lockedDragStartedRef.current = false;
      return;
    }

    // Confirm-before-placing: any board tap commits the locked preview position
    if (lockedPreview) {
      if (lockedPreview.valid) {
        const nextGame = applyPlacement(game, lockedPreview.pieceId, lockedPreview.row, lockedPreview.col);
        if (nextGame !== game) {
          primeSound();
          playPlaceSound();
          if (nextGame.cleared.length > 0) {
            window.setTimeout(() => { playClearSound(); }, 50);
          }
          recordVerifiedMove(lockedPreview.pieceId, lockedPreview.row, lockedPreview.col);
        }
        setLockedPreview(null);
        setGame(nextGame);
      } else {
        setLockedPreview(null);
        setGame((current) => ({ ...clearPreview(current), selectedPieceId: null }));
      }
      return;
    }

    if (!game.selectedPieceId) {
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

  async function handleStatsShare() {
    if (!hasSupabaseConfig || !session?.user?.id || profile?.has_shared_stats) return;
    setProfile((p) => p ? { ...p, has_shared_stats: true } : p);
    await supabase
      .from("profiles")
      .update({ has_shared_stats: true })
      .eq("id", session.user.id);
  }

  async function handleThemeSelect(key) {
    if (!unlockedThemes.has(key)) return;
    primeSound();
    playPlaceSound();
    setActiveTheme(key);
    setShowThemeModal(false);
    try { localStorage.setItem("gridpop-theme", key); } catch {}
    if (!hasSupabaseConfig || !session?.user?.id) return;
    const { error } = await supabase
      .from("profiles")
      .update({ theme: key })
      .eq("id", session.user.id);
    if (error) {
      setAuthError("Theme saved locally but could not sync to your account.");
    }
  }

  async function handleSignOut() {
    if (!hasSupabaseConfig) {
      return;
    }
    primeSound();
    playPlaceSound();
    setAuthError("");
    setAuthMessage("");

    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      const lower = error.message?.toLowerCase() ?? "";
      const isStaleSessionError =
        lower.includes("session") ||
        lower.includes("refresh token") ||
        lower.includes("jwt") ||
        lower.includes("unauthorized");

      if (!isStaleSessionError) {
        setAuthError(error.message);
        return;
      }
    }

    resetClientSessionState("Signed out.");
    clearActiveRunSession();
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

  function resetProfilePanelState() {
    setEditingProfile(false);
    setAuthError("");
    setAuthMessage("");
  }

  function handleToggleMobileAuthPanel() {
    setAuthAutoFocus(false);
    resetProfilePanelState();
    primeSound();
    playPlaceSound();
    setShowMobileAuthPanel((current) => !current);
  }

  function handleCloseMobileAuthPanel() {
    setAuthAutoFocus(false);
    resetProfilePanelState();
    primeSound();
    playPlaceSound();
    setShowMobileAuthPanel(false);
  }

  function handleToggleDesktopAuthPanel() {
    setAuthAutoFocus(false);
    resetProfilePanelState();
    primeSound();
    playPlaceSound();
    setShowDesktopAuthPanel((current) => !current);
  }

  function handleCloseDesktopAuthPanel() {
    setAuthAutoFocus(false);
    resetProfilePanelState();
    primeSound();
    playPlaceSound();
    setShowDesktopAuthPanel(false);
  }

  function handleAuthOverlayPointerDown(event) {
    authOverlayPointerStartedOnBackdropRef.current = event.target === event.currentTarget;
  }

  function handleMobileAuthOverlayClick(event) {
    if (authOverlayPointerStartedOnBackdropRef.current && event.target === event.currentTarget) {
      handleCloseMobileAuthPanel();
    }
    authOverlayPointerStartedOnBackdropRef.current = false;
  }

  function handleDesktopAuthOverlayClick(event) {
    if (authOverlayPointerStartedOnBackdropRef.current && event.target === event.currentTarget) {
      handleCloseDesktopAuthPanel();
    }
    authOverlayPointerStartedOnBackdropRef.current = false;
  }

  function handleOpenLeaderboard(tab = "personal") {
    resetProfilePanelState();
    primeSound();
    playPlaceSound();
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
    primeSound();
    playPlaceSound();
    if (nextTab === "personal") {
      setPersonalVisibleCount(0);
    }
    if (nextTab === "global") {
      setGlobalVisibleCount(0);
    }
    setLeaderboardTab(nextTab);
  }

  function handleCloseLeaderboard() {
    primeSound();
    playPlaceSound();
    setLeaderboardOpen(false);
  }

  function handleShowStats() {
    resetProfilePanelState();
    primeSound();
    playPlaceSound();
    setShowDesktopAuthPanel(false);
    setShowMobileAuthPanel(false);
    setShowStats(true);
  }

  function handleOpenThemes() {
    resetProfilePanelState();
    primeSound();
    playPlaceSound();
    setShowDesktopAuthPanel(false);
    setShowMobileAuthPanel(false);
    setShowThemeModal(true);
  }

  function handleOpenAuthPrompt({ autoFocus = false } = {}) {
    setAuthAutoFocus(autoFocus);
    resetProfilePanelState();
    setShowThemeModal(false);
    if (window.matchMedia("(max-width: 980px)").matches) {
      setShowDesktopAuthPanel(false);
      setShowMobileAuthPanel(true);
      return;
    }
    setShowMobileAuthPanel(false);
    setShowDesktopAuthPanel(true);
  }

  function handleToggleThemeModal() {
    if (showThemeModal) {
      handleCloseThemeModal();
      return;
    }
    handleOpenThemes();
  }

  function handleCloseThemeModal() {
    primeSound();
    playPlaceSound();
    setShowThemeModal(false);
  }

  function handleOpenHowToPlay() {
    primeSound();
    playPlaceSound();
    setShowHowToPlay(true);
  }

  function handleCloseHowToPlay() {
    primeSound();
    playPlaceSound();
    setShowHowToPlay(false);
  }

  function handleOpenChangelog() {
    primeSound();
    playPlaceSound();
    setShowChangelog(true);
  }

  function handleCloseStats() {
    primeSound();
    playPlaceSound();
    setShowStats(false);
  }

  function handleCloseChangelog() {
    primeSound();
    playPlaceSound();
    setShowChangelog(false);
  }

  function handleEditProfile() {
    primeSound();
    playPlaceSound();
    setDisplayNameDraft(profile?.display_name ?? "");
    setEditingProfile(true);
    setAuthError("");
    setAuthMessage("");
  }

  function handleCancelEditProfile() {
    primeSound();
    playPlaceSound();
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

  // Derive locked preview cell set for board highlighting
  const lockedPreviewSet = new Set();
  let lockedPreviewTone = null;
  let lockedPreviewPiece = null;
  if (lockedPreview?.valid) {
    lockedPreviewPiece = findPiece(game.tray, lockedPreview.pieceId);
    if (lockedPreviewPiece) {
      lockedPreviewTone = lockedPreviewPiece.tone;
      for (const [dx, dy] of lockedPreviewPiece.shape.cells) {
        lockedPreviewSet.add(toIndex(lockedPreview.row + dy, lockedPreview.col + dx));
      }
    }
  }
  const dragPiece = drag ? findPiece(game.tray, drag.pieceId) : null;
  const showDragGhost = Boolean(dragPiece && drag?.armed);
  const dragGhostMetrics = dragPiece ? dragBoardMetricsRef.current : null;
  const dragGhostStyle = {
    transform: getGhostTransform(dragPointerRef.current.x, dragPointerRef.current.y),
  };
  const accountBestScore = accountTopRuns[0]?.score ?? 0;
  const localTopRuns = [...localRuns]
    .sort((left, right) => right.score - left.score || left.createdAt.localeCompare(right.createdAt))
    .slice(0, PERSONAL_TOP_RUN_LIMIT);
  const localRunNumbers = Object.fromEntries(
    localRuns.map((run, index) => [String(run.id), Math.max(1, localRuns.length - index)])
  );
  const displayedBestScore = session
    ? Math.max(game.score, accountBestScore)
    : game.bestScore;
  const personalRuns = session ? accountRecentRuns : localRuns.slice(0, PERSONAL_RECENT_RUN_LIMIT);
  const personalTopRuns = session ? accountTopRuns : localTopRuns;
  const personalRunNumbers = session ? accountRunNumbers : localRunNumbers;
  const personalTopRunNumbers = session ? accountRunNumbers : localRunNumbers;
  const personalLabel = session ? "My Runs" : "This Device";
  const personalLoading = session ? accountRunsLoading : false;
  const personalError = session ? accountRunsError : "";
  const personalRunCount = session ? (accountStats?.gamesPlayed ?? personalRuns.length) : localRuns.length;
  const showUpdatePrompt = updateReady && !updateDismissed && (!started || game.gameOver);

  useEffect(() => {
    if (
      !rankedReady ||
      started ||
      resumePending ||
      !activeRunCheckDone ||
      !activeRunDetected?.id ||
      startAccountPending
    ) {
      return;
    }

    const preferredSession = detectedRunPreferredSession;

    if (!preferredSession || autoResumeAttemptedRunIdRef.current === activeRunDetected.id) {
      return;
    }

    autoResumeAttemptedRunIdRef.current = activeRunDetected.id;
    void resumeRun({ preferredSession, clearStartOverlay: true });
  }, [
    activeRunCheckDone,
    activeRunDetected,
    detectedRunPreferredSession,
    rankedReady,
    resumePending,
    resumeRun,
    startAccountPending,
    started,
  ]);

  useEffect(() => {
    const nextPersonalRuns = session ? accountRecentRuns : localRuns.slice(0, PERSONAL_RECENT_RUN_LIMIT);

    if (!leaderboardOpen || leaderboardTab !== "personal") {
      setPersonalVisibleCount(0);
      return;
    }

    if (personalLoading) {
      setPersonalVisibleCount(0);
      return;
    }

    if (personalError || nextPersonalRuns.length === 0) {
      setPersonalVisibleCount(nextPersonalRuns.length);
      return;
    }

    setPersonalVisibleCount(1);

    if (soundEnabled) {
      playFillCellSound();
    }

    const timers = nextPersonalRuns.slice(1).map((_, index) =>
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
  }, [accountRecentRuns, leaderboardOpen, leaderboardTab, localRuns, personalError, personalLoading, session, soundEnabled]);

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
            aria-label={showMobileAuthPanel ? "Close menu" : "Open menu"}
          >
            <CogIcon />
          </button>
          <ThemeTrigger active={showThemeModal} hasUnread={hasUnreadThemes} mobile onClick={handleToggleThemeModal} />
          <button
            className={`sound-icon-button hero-info-button${showHowToPlay ? " is-active" : ""}`}
            type="button"
            onClick={handleOpenHowToPlay}
            aria-label="How to play"
          >
            <span className="info-icon-letter" aria-hidden="true">i</span>
          </button>
          <button
            className={`sound-icon-button hero-sound-button${soundEnabled && soundVolume > 0 ? " is-active" : ""}`}
            type="button"
            onClick={handleToggleSound}
            aria-label={soundEnabled && soundVolume > 0 ? "Mute sound" : "Enable sound"}
          >
            <SpeakerIcon on={soundEnabled && soundVolume > 0} />
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
                onClick={() => handleOpenLeaderboard("personal")}
              />
              <ScoreboardTrigger onClick={() => handleOpenLeaderboard("global")} />
            </div>
            <div className="mobile-player-handle">
              {playerHandleMessage ? (
                <PlayerHandleStatus message={playerHandleMessage} />
              ) : (
                <PlayerHandle displayName={profile?.display_name ?? null} />
              )}
            </div>
            <div className="desktop-auth-panel">
              <MenuTrigger active={showDesktopAuthPanel} onClick={handleToggleDesktopAuthPanel} />
              <ThemeTrigger active={showThemeModal} hasUnread={hasUnreadThemes} onClick={handleToggleThemeModal} />
            </div>
          </aside>

          <section className="playfield">
            <div className="playfield-header">
              <div className="desktop-player-handle">
                {playerHandleMessage ? (
                  <PlayerHandleStatus message={playerHandleMessage} />
                ) : (
                  <PlayerHandle displayName={profile?.display_name ?? null} />
                )}
              </div>
            </div>
            <div className="board-container">
              <Board
                boardRef={boardRef}
                lockedPreviewPath={lockedPreviewPath}
                board={displayBoard}
                clearedSet={clearedSet}
                clearedTones={game.clearedTones}
                interactionLocked={runInteractionLocked}
                lockedPreviewSet={lockedPreviewSet}
                lockedPreviewTone={lockedPreviewTone}
                previewClearSet={previewClearSet}
                previewTone={previewTone}
                started={started}
                onBoardMove={handleBoardMove}
                onBoardLeave={handleBoardLeave}
                onCellClick={handleCellClick}
                onLockedPreviewPointerDown={lockedPreviewPiece ? (e) => handleLockedPreviewPointerDown(lockedPreviewPiece, e) : undefined}
              />
              {!started ? (
                <div className="start-overlay" role="dialog" aria-modal="true" aria-label="Start game">
                  {startFailed ? (
                    <>
                      <p className="start-failed-msg">Couldn't reach GridPop servers.</p>
                      <button className="start-button" type="button" onClick={handleStartGame}>Retry</button>
                      <button className="start-local-button" type="button" onClick={startLocalGame}>Play Locally</button>
                    </>
                  ) : startOverlayPassiveMessage ? (
                    <div className="overlay-spinner" aria-label="Loading" role="status">
                      <span className="overlay-spinner-dot" />
                      <span className="overlay-spinner-dot" />
                      <span className="overlay-spinner-dot" />
                    </div>
                  ) : activeRunDetected && activeRunCheckDone ? (
                    <>
                      <p className="start-resume-msg">Pick up where you left off?</p>
                      {resumeFailed ? <p className="start-failed-msg">{resumeFailed}</p> : null}
                      <button className="start-button" type="button" onClick={handleContinueGame} disabled={resumePending || startBlocked}>
                        Continue
                      </button>
                      <button className="start-local-button" type="button" onClick={handleNewGame} disabled={resumePending || startBlocked}>
                        Start new
                      </button>
                    </>
                  ) : (
                    <>
                      {resumeFailed ? <p className="start-failed-msg">{resumeFailed}</p> : null}
                      <button className="start-button" type="button" onClick={handleStartGame} disabled={startBlocked || resumePending}>
                        Start Game
                      </button>
                    </>
                  )}
                </div>
              ) : null}
              {resumedElsewhere ? (
                <div className="start-overlay resumed-elsewhere-overlay" role="dialog" aria-modal="true" aria-label="GridPop! is open in another window">
                  <p className="resumed-elsewhere-title">GridPop! is open in another window</p>
                  {game.score > 0 ? <p className="resumed-elsewhere-score">{game.score.toLocaleString()}</p> : null}
                  {resumeFailed ? <p className="start-failed-msg">{resumeFailed}</p> : null}
                  {!resumeRunGone && (
                    <button className="start-button" type="button" onClick={handleResumeHere} disabled={resumePending}>
                      Resume here
                    </button>
                  )}
                  <button className="start-local-button" type="button" onClick={handleStartFresh} disabled={resumePending}>
                    Start new
                  </button>
                </div>
              ) : null}
              {showRunReconnectOverlay ? (
                <div className="start-overlay resumed-elsewhere-overlay" role="dialog" aria-modal="true" aria-label="Reconnect run">
                  <p className="resumed-elsewhere-title">Lost connection</p>
                  <p className="resumed-elsewhere-body">{runReconnectOverlayMessage}</p>
                  {runReconnectActionRequired !== "resume-gone" ? (
                    <button className="start-button" type="button" onClick={handleReconnectRun} disabled={resumePending}>
                      {resumePending ? "Reconnecting..." : "Reconnect"}
                    </button>
                  ) : null}
                  <button className="start-local-button" type="button" onClick={handleStartFresh} disabled={resumePending}>
                    Start new
                  </button>
                </div>
              ) : null}
              {gameOverPhase === 'overlay' ? (
                <div
                  className={`start-overlay game-over-overlay${showNewBestBanner ? ' is-new-best' : ''}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Game over"
                >
                  <div className="game-over-content">
                    <div className="game-over-score-group">
                      {showNewBestBanner && <p className="new-best-banner">✨ New Best! ✨</p>}
                      <p className={`game-over-score${scoreFinished ? ' is-done' : ''}`}>{displayedScore}</p>
                    </div>
                    <div className="game-over-mid">
                      <div className="game-over-divider" />
                      <div className="game-over-stats">
                        <div className={`game-over-stat${statsRevealed >= 1 ? ' is-revealed' : ''}`}>
                          <span className="game-over-stat-value">{game.moveCount}</span>
                          <span className="game-over-stat-label">shapes played</span>
                        </div>
                        <div className={`game-over-stat${statsRevealed >= 2 ? ' is-revealed' : ''}`}>
                          <span className="game-over-stat-value">x{game.bestCombo + 1}</span>
                          <span className="game-over-stat-label">highest chain</span>
                        </div>
                        {game.bestLinesCleared > 0 && (
                          <div className={`game-over-stat${statsRevealed >= 3 ? ' is-revealed' : ''}`}>
                            <span className="game-over-stat-value">{game.bestLinesCleared} {game.bestLinesCleared === 1 ? 'line' : 'lines'}</span>
                            <span className="game-over-stat-label">biggest burst</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`game-over-actions${showPlayAgain ? ' is-visible' : ''}`}>
                      <button className="start-button" type="button" onClick={handleRestart} disabled={runSubmitting || startPending || (!!session && !accountRunsReadyRef.current)}>
                        Play Again
                      </button>
                      {runSubmissionError ? (
                        <button
                          className="leaderboard-empty run-submission-retry"
                          type="button"
                          onClick={() => {
                            if (!activeVerifiedRun?.id) {
                              if (!session?.user?.id) {
                                handleOpenAuthPrompt();
                              }
                              return;
                            }
                            runSubmissionInFlightRef.current.delete(activeVerifiedRun.id);
                            syncRunSubmittingState(runSubmissionInFlightRef.current, setRunSubmitting);
                            setRunSubmissionError("");
                            setFinishRunAttempt((n) => n + 1);
                          }}
                        >
                          {runSubmissionError}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {!session && hasSupabaseConfig ? (
                    <div className={`game-over-footer${showPlayAgain ? ' is-visible' : ''}`}>
                      <ul className="game-over-signin-benefits">
                        <li>Global Leaderboard</li>
                        <li>Unlockable Themes</li>
                        <li>Sync Across Devices</li>
                      </ul>
                      <button
                        className="game-over-signin-cta"
                        type="button"
                        onClick={() => handleOpenAuthPrompt({ autoFocus: true })}
                      >
                        Create your player profile
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <aside className={`sidebar${drag?.armed ? " is-drag-active" : ""}`}>
            <Tray
              tray={game.tray}
              selectedPieceId={game.selectedPieceId}
              gameOver={game.gameOver}
              interactionLocked={runInteractionLocked}
              started={started}
              awaitingTray={game.awaitingTray}
              nextTrayPending={nextTrayPending}
              nextTrayError={nextTrayError}
              trayRevealToken={trayRevealToken}
              soundEnabled={soundEnabled}
              onTrayPieceReveal={handleTrayPieceReveal}
              onRetryNextTray={() => {
                if (!nextTrayPending) {
                  setNextTrayError("");
                  setNextTrayRetryTick((tick) => tick + 1);
                }
              }}
              onSelectPiece={handleSelectPiece}
              onStartDrag={handleStartDrag}
            />
            <div ref={dismissZoneRef} className="drag-dismiss-zone" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M9 14L4 9l5-5"/>
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
              </svg>
              <span>return to tray</span>
            </div>
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
          <span className="site-footer-separator" aria-hidden="true">·</span>
          <button
            className="site-footer-version site-footer-version--button"
            type="button"
            onClick={handleOpenChangelog}
            aria-label={hasUnreadChangelog ? `View changelog for new in version ${CLIENT_VERSION.replace("gridpop-web-", "")}` : "View changelog"}
          >
            <span>{CLIENT_VERSION.replace("gridpop-web-", "v")}</span>
            {hasUnreadChangelog ? <span className="ui-pill-badge">New!</span> : null}
          </button>
        </footer>

        {showUpdatePrompt ? (
          <div className="update-toast" role="status" aria-live="polite">
            <div className="update-toast-copy">
              <strong>Please reload</strong>
              <span>GridPop! update available</span>
            </div>
            <div className="update-toast-actions">
              <button
                className="update-toast-button"
                type="button"
                onClick={() => {
                  setUpdateDismissed(true);
                  onDismissUpdate();
                }}
              >
                Later
              </button>
              <button className="update-toast-button update-toast-button--primary" type="button" onClick={onApplyUpdate}>
                Reload
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {showMobileAuthPanel ? (
        <div
          className="mobile-auth-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Player account"
          onPointerDown={handleAuthOverlayPointerDown}
          onClick={handleMobileAuthOverlayClick}
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
            <SettingsPanel
              soundVolume={soundVolume}
              onVolumeChange={handleVolumeChange}
              gridStickiness={gridStickiness}
              onStickinessChange={handleStickinessChange}
              showAccessibleThemes={showAccessibleThemes}
              onShowAccessibleThemesChange={handleShowAccessibleThemesChange}
              confirmPlacement={confirmPlacement}
              onConfirmPlacementChange={handleConfirmPlacementChange}
              crtFilterLevel={crtFilterLevel}
              onCrtFilterLevelChange={handleCrtFilterLevelChange}
            />
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
              onShowStats={handleShowStats}
              onSignOut={handleSignOut}
              onVerifyCode={handleVerifyCode}
              otpSentTo={otpSentTo}
              profile={profile}
              profileLoading={profileLoading}
              profilePending={profilePending}
              session={session}
              focusEmail={authAutoFocus}
            />
          </div>
        </div>
      ) : null}

      {showDesktopAuthPanel ? (
        <div
          className="desktop-auth-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Player account"
          onPointerDown={handleAuthOverlayPointerDown}
          onClick={handleDesktopAuthOverlayClick}
        >
          <div className="desktop-auth-dialog" onClick={(event) => event.stopPropagation()}>
            <button
              className="desktop-auth-close"
              type="button"
              onClick={handleCloseDesktopAuthPanel}
              aria-label="Close sign in panel"
            >
              Close
            </button>
            <SettingsPanel
              soundVolume={soundVolume}
              onVolumeChange={handleVolumeChange}
              gridStickiness={gridStickiness}
              onStickinessChange={handleStickinessChange}
              showAccessibleThemes={showAccessibleThemes}
              onShowAccessibleThemesChange={handleShowAccessibleThemesChange}
              confirmPlacement={confirmPlacement}
              onConfirmPlacementChange={handleConfirmPlacementChange}
              crtFilterLevel={crtFilterLevel}
              onCrtFilterLevelChange={handleCrtFilterLevelChange}
            />
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
              onShowStats={handleShowStats}
              onSignOut={handleSignOut}
              onVerifyCode={handleVerifyCode}
              otpSentTo={otpSentTo}
              profile={profile}
              profileLoading={profileLoading}
              profilePending={profilePending}
              session={session}
              focusEmail={authAutoFocus}
            />
          </div>
        </div>
      ) : null}

      {showHowToPlay ? <HowToPlayModal onClose={handleCloseHowToPlay} onOpenChangelog={handleOpenChangelog} hasUnreadChangelog={hasUnreadChangelog} /> : null}
      {showThemeModal ? (
        <ThemeModal
          activeTheme={activeTheme}
          showAccessibleThemes={showAccessibleThemes}
          signedIn={Boolean(session?.user?.id)}
          unlockedThemes={unlockedThemes}
          onGuestSignIn={handleOpenAuthPrompt}
          onSelect={handleThemeSelect}
          onClose={handleCloseThemeModal}
        />
      ) : null}
      {showStats ? (
        <StatsModal
          displayName={profile?.display_name ?? ""}
          onClose={handleCloseStats}
          onShare={handleStatsShare}
          stats={aggregateStats}
          theme={THEMES.find(t => t.key === activeTheme) ?? THEMES[0]}
        />
      ) : null}

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
        personalRunCount={personalRunCount}
        personalRuns={personalRuns}
        personalRunNumbers={personalRunNumbers}
        personalTopRuns={personalTopRuns}
        personalTopRunNumbers={personalTopRunNumbers}
        personalVisibleCount={personalVisibleCount}
        signedIn={Boolean(session)}
        onClose={handleCloseLeaderboard}
        onTabChange={handleLeaderboardTabChange}
        open={leaderboardOpen}
      />

      {showChangelog ? (
        <ChangelogModal onClose={handleCloseChangelog} />
      ) : null}

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
