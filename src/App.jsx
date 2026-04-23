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
  setRankedTray,
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

const THEMES = [
  {
    key: "classic", name: "Classic", free: true,
    grid: [
      [1, 1, 0, 2, 0, 0, 3, 3],
      [0, 1, 0, 2, 2, 0, 0, 3],
      [4, 0, 0, 0, 2, 5, 0, 3],
    ],
    board: "linear-gradient(145deg,rgba(225,210,255,0.96),rgba(205,185,252,0.93))",
    cell: "rgba(130,80,200,0.15)", cellBorder: "rgba(110,60,180,0.2)",
    tones:   ["#ffb0cc", "#ffe480", "#90e8d0", "#60dcf0", "#dcd8d2"],
    tonesHi: ["#ffeef5", "#fffbe8", "#eafff7", "#e8fbff", "#fefefe"],
    tonesLo: ["#ff9dc4", "#ffe080", "#7adec8", "#50d8f0", "#e0dbd6"],
  },
  {
    key: "classic-dark", name: "Classic Dark", free: true,
    grid: [
      [1, 0, 2, 2, 0, 3, 0, 4],
      [1, 1, 0, 2, 3, 3, 0, 4],
      [0, 1, 5, 0, 0, 3, 4, 4],
    ],
    board: "linear-gradient(145deg,rgba(50,15,90,0.85),rgba(30,8,65,0.92))",
    cell: "rgba(255,255,255,0.04)", cellBorder: "rgba(180,140,255,0.14)",
    tones:   ["#ff70a8", "#ffd040", "#40d8b0", "#20c8e8", "#c8b8e8"],
    tonesHi: ["#ffaace", "#ffe888", "#80eed0", "#70e0f4", "#e0d8f4"],
    tonesLo: ["#e0508a", "#e0aa20", "#20b890", "#10a8cc", "#a890d0"],
  },
  {
    key: "gen-y", name: "Gen Y", unlock: "Play 50 games",
    grid: [
      [0, 1, 0, 0, 0, 2, 0, 0],
      [0, 1, 1, 0, 0, 2, 0, 3],
      [0, 0, 1, 0, 0, 2, 3, 3],
    ],
    board: "linear-gradient(145deg,rgba(235,220,195,0.95),rgba(218,202,176,0.92))",
    cell: "rgba(160,120,80,0.1)", cellBorder: "rgba(140,100,60,0.18)",
    tones:   ["#e8c0a0", "#ddc890", "#b8c8a8", "#c0c4c8", "#e0d8c8"],
    tonesHi: ["#fff4ed", "#fff8e4", "#f0f5e8", "#f0f2f4", "#faf8f0"],
    tonesLo: ["#d4a880", "#c8b070", "#9ab88a", "#a8b0b8", "#ccc4b0"],
  },
  {
    key: "dmg", name: "DMG", unlock: "Pop 4+ lines in one move",
    grid: [
      [1, 1, 2, 2, 3, 3, 4, 4],
      [1, 0, 0, 2, 0, 3, 0, 4],
      [5, 5, 0, 0, 0, 0, 0, 4],
    ],
    board: "linear-gradient(145deg,#9bbc0f,#8bac0f)",
    cell: "rgba(15,56,15,0.06)", cellBorder: "rgba(15,56,15,0.14)",
    tones:   ["#0f380f", "#1e4e10", "#306230", "#4a7828", "#628c18"],
    tonesHi: ["#1e520e", "#306230", "#427840", "#5e9030", "#7aa820"],
    tonesLo: ["#0a2808", "#142e08", "#204820", "#386018", "#4e7010"],
  },
  {
    key: "broadcast", name: "Broadcast", unlock: "Share your stats",
    grid: [
      [0, 1, 0, 2, 0, 3, 0, 4],
      [1, 1, 0, 2, 3, 3, 0, 4],
      [0, 1, 5, 2, 0, 3, 4, 4],
    ],
    board: "linear-gradient(145deg,#111118,#0a0a14)",
    cell: "rgba(255,255,255,0.04)", cellBorder: "rgba(255,255,255,0.08)",
    tones:   ["#ff2244", "#ffee00", "#00ff44", "#00eeff", "#e0e0e0"],
    tonesHi: ["#ff8899", "#ffff88", "#88ffaa", "#88ffff", "#ffffff"],
    tonesLo: ["#cc0022", "#cccc00", "#00cc33", "#00ccdd", "#c0c0c0"],
  },
  {
    key: "y2k", name: "Y2K", unlock: "Score 20,000+",
    grid: [
      [1, 2, 3, 0, 4, 5, 1, 2],
      [1, 2, 3, 3, 4, 5, 0, 2],
      [0, 2, 0, 3, 4, 5, 5, 0],
    ],
    board: "linear-gradient(145deg,rgba(0,20,60,0.9),rgba(0,10,40,0.95))",
    cell: "rgba(0,100,200,0.08)", cellBorder: "rgba(0,200,255,0.14)",
    tones:   ["#0088ff", "#a0b8d0", "#00ff88", "#00eeff", "#9900ff"],
    tonesHi: ["#66ccff", "#d0e4f0", "#88ffcc", "#88ffff", "#cc88ff"],
    tonesLo: ["#0055cc", "#7090b0", "#00cc66", "#00bbdd", "#7700cc"],
  },
  {
    key: "summit", name: "Summit", condition: "top10",
    grid: [
      [1, 0, 2, 0, 3, 0, 4, 0],
      [1, 2, 2, 0, 3, 3, 0, 4],
      [0, 2, 0, 3, 0, 3, 4, 4],
    ],
    board: "linear-gradient(145deg,rgba(90,165,225,0.85),rgba(55,135,205,0.90))",
    cell: "rgba(255,255,255,0.18)", cellBorder: "rgba(255,255,255,0.30)",
    tones:   ["#5aaae0", "#2277bb", "#88c8f0", "#3399cc", "#aad8f0"],
    tonesHi: ["#9ccef4", "#66aadd", "#c4e8f8", "#77bbdd", "#cceeff"],
    tonesLo: ["#3388cc", "#1155aa", "#66aacc", "#1177aa", "#88bbcc"],
  },
  {
    key: "crown", name: "Crown", condition: "rank1",
    grid: [
      [0, 1, 0, 2, 0, 1, 0, 2],
      [1, 1, 2, 2, 0, 1, 3, 2],
      [0, 0, 2, 0, 3, 3, 3, 0],
    ],
    board: "linear-gradient(145deg,rgba(210,160,30,0.88),rgba(185,135,10,0.92))",
    cell: "rgba(120,80,0,0.08)", cellBorder: "rgba(150,100,0,0.18)",
    tones:   ["#d4a017", "#e8880a", "#c87800", "#f0c030", "#b87010"],
    tonesHi: ["#f0cc66", "#ffcc66", "#eeaa44", "#ffe080", "#e0a844"],
    tonesLo: ["#aa7800", "#c06800", "#9a5800", "#cca020", "#8a5800"],
  },
  {
    key: "greige", name: "Greige", unlock: "Score under 500",
    grid: [
      [0, 0, 0, 1, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 0, 2, 0],
      [0, 0, 0, 0, 0, 0, 2, 2],
    ],
    board: "linear-gradient(145deg,#d8d7d4,#c8c7c4)",
    cell: "rgba(60,60,60,0.07)", cellBorder: "rgba(60,60,60,0.14)",
    tones:   ["#505050", "#888888", "#6c6c6c", "#b0b0b0", "#383838"],
    tonesHi: ["#707070", "#a8a8a8", "#8c8c8c", "#d0d0d0", "#585858"],
    tonesLo: ["#383838", "#686868", "#505050", "#909090", "#282828"],
  },
  {
    key: "dev", name: "Dev", unlock: "Caught poking around", secret: true,
    grid: [
      [1, 0, 2, 0, 3, 0, 4, 0],
      [0, 1, 0, 2, 0, 3, 0, 4],
      [5, 0, 1, 0, 2, 0, 3, 0],
    ],
    board: "linear-gradient(145deg,rgba(10,16,12,0.96),rgba(18,28,20,0.98))",
    cell: "rgba(135,255,180,0.06)", cellBorder: "rgba(135,255,180,0.18)",
    tones:   ["#5eff9a", "#9dff6a", "#41e6c2", "#8ae1ff", "#b6bcc4"],
    tonesHi: ["#c9ffd9", "#e4ffb8", "#aaf8e8", "#d4f8ff", "#edf1f4"],
    tonesLo: ["#1da74b", "#5eaf20", "#138e76", "#2e8fb0", "#6c737c"],
  },
];

const FREE_THEME_KEYS = new Set(THEMES.filter((theme) => theme.free).map((theme) => theme.key));

function getUnlockedThemes(stats, profile, globalRuns = [], userId = null, devThemeUnlocked = false) {
  const unlocked = new Set(["classic", "classic-dark"]);
  if (stats?.gamesPlayed >= 50) unlocked.add("gen-y");
  if (stats?.bestLinesCleared >= 4) unlocked.add("dmg");
  if (profile?.has_shared_stats) unlocked.add("broadcast");
  if (stats?.bestScore >= 20000) unlocked.add("y2k");
  if (stats?.hasLowScore) unlocked.add("greige");
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
const CLIENT_VERSION = "gridpop-web-1.2";
const PENDING_RUN_KEY = "gridpop-pending-run";
const DEV_THEME_UNLOCK_KEY = "gridpop-dev-theme";
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

async function buildStatsCardBlob(displayName, stats, theme) {
  const W = 1080;
  const PAD = 80;
  const GAP = 18;
  const FOOTER_SIZE = 26;
  const BOTTOM_PAD = 72;

  await document.fonts.ready;

  // Resolve theme-aware colors from live CSS vars + theme data
  const style = getComputedStyle(document.documentElement);
  const bgTop = style.getPropertyValue('--bg-top').trim() || '#cfa8ff';
  const bgBottom = style.getPropertyValue('--bg-bottom').trim() || '#9ecfff';
  const textColor = style.getPropertyValue('--text').trim() || '#38106a';
  const panelColor = style.getPropertyValue('--panel').trim() || 'rgba(255,255,255,0.82)';
  const tones = theme?.tones ?? ["#ffb0cc", "#ffe480", "#90e8d0", "#60dcf0", "#dcd8d2"];
  const accent = tones[0];

  // Build chunk data up front so we can calculate total height before creating the canvas
  const hero = stats?.bestScore > 0
    ? [["Best score", stats.bestScore.toLocaleString()]]
    : [];

  const activity = [];
  if (stats?.gamesPlayed > 0) activity.push(["Games played", String(stats.gamesPlayed)]);
  if (stats?.mostMoves > 0) activity.push(["Most moves in a game", String(stats.mostMoves)]);

  const skills = [];
  if (stats?.bestCombo > 0) skills.push(["Highest combo", `\u00d7${stats.bestCombo + 1}`]);
  if (stats?.bestMoveScore > 0) skills.push(["Best single move", stats.bestMoveScore.toLocaleString()]);
  if (stats?.bestLinesCleared > 0) skills.push(["Most lines in a single move", String(stats.bestLinesCleared)]);

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
      const blob = await buildStatsCardBlob(displayName, stats, theme);
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
                <dt>Highest combo</dt>
                <dd>{stats.bestCombo > 0 ? `\u00d7${stats.bestCombo + 1}` : "\u2014"}</dd>
              </div>
              <div className="stats-row">
                <dt>Best single move</dt>
                <dd>{stats.bestMoveScore > 0 ? stats.bestMoveScore.toLocaleString() : "\u2014"}</dd>
              </div>
              <div className="stats-row">
                <dt>Most lines in a single move</dt>
                <dd>{stats.bestLinesCleared > 0 ? stats.bestLinesCleared : "\u2014"}</dd>
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
                <p>Drag a shape from the tray onto the grid. Each coloured square is a poxel and every poxel you place scores points.</p>
                <p className="how-to-play-pts">10 pts per poxel</p>
              </div>
            </div>
            <div className="how-to-play-step">
              <MiniBoard grid={clearGrid} />
              <div className="how-to-play-step-body">
                <strong className="how-to-play-step-title">Pop</strong>
                <p>Fill a full row or column of poxels and the whole line pops. Pop multiple lines in one move for a bonus.</p>
                <p className="how-to-play-pts">120 pts per line, more for multiples</p>
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

function PlayerHandleStatus({ message }) {
  if (!message) {
    return null;
  }

  return <p className="player-handle player-handle--status">{message}</p>;
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

function ThemeTrigger({ active, mobile = false, onClick }) {
  if (mobile) {
    return (
      <button
        className="sound-icon-button hero-theme-button is-active"
        type="button"
        onClick={onClick}
        aria-label={active ? "Close themes" : "Open themes"}
      >
        <PaletteIcon />
      </button>
    );
  }

  return (
    <button
      className={`theme-trigger${active ? " is-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-label={active ? "Close themes" : "Open themes"}
    >
      <PaletteIcon />
      <span>Themes</span>
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
                <div className="leaderboard-hero leaderboard-hero--global leaderboard-hero--skeleton" aria-hidden="true">
                  <span className="leaderboard-hero-rank">&nbsp;</span>
                  <strong className="leaderboard-hero-score">&nbsp;</strong>
                  <span className="leaderboard-hero-name">&nbsp;</span>
                </div>
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

function ThemePreviewBoard({ board, cell, cellBorder, tones, tonesHi, tonesLo, grid }) {
  return (
    <div className="theme-preview-board" style={{ background: board }}>
      {grid.flat().map((tone, i) =>
        tone === 0 ? (
          <div
            key={i}
            className="theme-preview-cell theme-preview-cell--empty"
            style={{ background: cell, borderColor: cellBorder }}
          />
        ) : (
          <div key={i} className="theme-preview-cell theme-preview-cell--filled">
            <div
              className="theme-preview-bubble"
              style={{
                background: `radial-gradient(circle at 35% 28%, ${tonesHi[tone - 1]}, ${tonesLo[tone - 1]} 85%)`,
              }}
            />
          </div>
        )
      )}
    </div>
  );
}

function getThemeUnlockHint(theme) {
  if (theme.free) return "Free";
  if (theme.key === "dev") return "Theme override detected";
  if (theme.condition === "rank1") return "Hold the #1 spot";
  if (theme.condition === "top10") return "Hold a top 10 spot";
  return theme.unlock;
}

function ThemeModal({ activeTheme, signedIn, unlockedThemes, onGuestSignIn, onSelect, onClose }) {
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
          <div className="theme-picker">
            {THEMES.filter((theme) => !theme.secret || unlockedThemes.has(theme.key)).map((theme) => {
              const isUnlocked = unlockedThemes.has(theme.key);
              const isActive = activeTheme === theme.key;
              const cardClassName = `theme-card${isActive ? " is-active" : ""}${!isUnlocked ? " is-locked" : ""}${!isUnlocked && !signedIn ? " is-guest-locked" : ""}`;
              const cardPreview = (
                <ThemePreviewBoard
                  board={theme.board}
                  cell={theme.cell}
                  cellBorder={theme.cellBorder}
                  tones={theme.tones}
                  tonesHi={theme.tonesHi}
                  tonesLo={theme.tonesLo}
                  grid={theme.grid}
                />
              );
              const cardLabel = (
                <div className="theme-card-label">
                  <span className="theme-card-name">{theme.name}{isActive ? " ✓" : ""}</span>
                  <span className="theme-card-hint">
                    {getThemeUnlockHint(theme)}
                  </span>
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

function storePendingRun(runId, moves) {
  try {
    localStorage.setItem(PENDING_RUN_KEY, JSON.stringify({
      runId,
      moves,
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
  const [started, setStarted] = useState(false);
  const [gameOverPhase, setGameOverPhase] = useState(null); // null | 'filling' | 'overlay'
  const [fillCells, setFillCells] = useState([]);
  const [isNewBest, setIsNewBest] = useState(false);
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
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [activeTheme, setActiveTheme] = useState(() => { try { return localStorage.getItem("gridpop-theme") ?? "classic"; } catch { return "classic"; } });
  const [devThemeUnlocked, setDevThemeUnlocked] = useState(() => {
    try {
      return localStorage.getItem(DEV_THEME_UNLOCK_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [activeVerifiedRun, setActiveVerifiedRun] = useState(null);
  const [startPending, setStartPending] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const [runSubmitting, setRunSubmitting] = useState(false);
  const [runSubmissionError, setRunSubmissionError] = useState("");
  const [nextTrayPending, setNextTrayPending] = useState(false);
  const [nextTrayError, setNextTrayError] = useState("");
  const [nextTrayRetryTick, setNextTrayRetryTick] = useState(0);
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
  const pickupSoundPlayedRef = useRef(false);
  const previewSoundRef = useRef({ key: null, at: 0 });
  const fillIntervalRef = useRef(null);
  const prevBestScoreRef = useRef(game.bestScore);
  const dragBoardMetricsRef = useRef(null);
  const livePreviewRef = useRef(game.preview);
  const queuedPreviewRef = useRef(null);
  const previewFrameRef = useRef(0);
  const activeVerifiedRunRef = useRef(activeVerifiedRun);
  const nextTrayFetchInFlightRef = useRef(false);
  const themeObserverBypassRef = useRef(false);

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
    setAuthCode("");
    setOtpSentTo("");
    setStartPending(false);
    nextTrayFetchInFlightRef.current = false;
    setNextTrayPending(false);
    setNextTrayError("");
    setNextTrayRetryTick(0);
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

  useEffect(() => {
    if (updateReady) {
      setUpdateDismissed(false);
    }
  }, [updateReady]);

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

    supabase.functions
      .invoke("finish-run", { body: { runId: pending.runId, moves: pending.moves } })
      .then(({ error }) => {
        if (!error) {
          try { localStorage.removeItem(PENDING_RUN_KEY); } catch {}
          loadAccountRuns();
          loadGlobalLeaderboard();
          return;
        }
        if (error instanceof FunctionsHttpError && error.context?.status === 409) {
          try { localStorage.removeItem(PENDING_RUN_KEY); } catch {}
        }
      });
  }, [session?.user?.id]);

  useEffect(() => {
    if (
      !GLOBAL_LEADERBOARD_ENABLED ||
      !hasSupabaseConfig ||
      !started ||
      game.gameOver ||
      !game.awaitingTray ||
      !activeVerifiedRun?.id
    ) {
      return;
    }

    if (nextTrayFetchInFlightRef.current) {
      return;
    }

    const pendingRun = activeVerifiedRun;
    nextTrayFetchInFlightRef.current = true;
    setNextTrayPending(true);
    setNextTrayError("");

    supabase.functions
      .invoke("next-tray", {
        body: {
          runId: pendingRun.id,
          moves: pendingRun.moves,
        },
      })
      .then(async ({ data, error }) => {
        nextTrayFetchInFlightRef.current = false;
        setNextTrayPending(false);

        if (error) {
          if (activeVerifiedRunRef.current?.id === pendingRun.id) {
            setNextTrayError(await getFunctionErrorMessage(error, "Could not load the next tray. Tap to retry."));
          }
          return;
        }

        setNextTrayError("");
        setGame((current) => (
          current.awaitingTray ? setRankedTray(current, data?.tray ?? []) : current
        ));
      });
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
    setRunSubmissionError("");
    storePendingRun(submittedRun.id, submittedRun.moves);

    supabase.functions
      .invoke("finish-run", {
        body: {
          runId: submittedRun.id,
          moves: submittedRun.moves,
        },
      })
      .then(async ({ error }) => {
        runSubmissionInFlightRef.current.delete(submittedRun.id);
        syncRunSubmittingState(runSubmissionInFlightRef.current, setRunSubmitting);

        if (error) {
          if (activeVerifiedRunRef.current?.id === submittedRun.id) {
            setRunSubmissionError(await getFunctionErrorMessage(error, "Could not submit this score. Tap to retry."));
          }
          return;
        }

        clearPendingRun(submittedRun.id);
        setActiveVerifiedRun((current) => (current?.id === submittedRun.id ? null : current));
        loadAccountRuns();
        loadGlobalLeaderboard();
      });
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
  const startAuthPending = Boolean(hasSupabaseConfig && !authReady);
  const startProfilePending = Boolean(session?.user?.id && profileLoading);
  const startAccountPending = Boolean(session?.user?.id && !accountRunsReadyRef.current);
  const startNeedsDisplayName = Boolean(session?.user?.id && !profileLoading && !profile?.display_name);
  const startBlocked = Boolean(startPending || startAuthPending || startProfilePending || startAccountPending);
  const startBlockedMessage = startAuthPending || startProfilePending
    ? "Loading your account..."
    : startAccountPending
      ? "Loading your score history..."
      : startNeedsDisplayName
        ? "Set a display name before starting."
        : "";
  const startHandleMessage = !started && !startFailed ? startBlockedMessage : "";

  const unlockedThemes = getUnlockedThemes(accountStats, profile, globalRuns, session?.user?.id, devThemeUnlocked);

  useEffect(() => {
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
    setActiveVerifiedRun((current) =>
      current
        ? {
            ...current,
            moves: [...current.moves, { pieceId, row, col }],
          }
        : current
    );
  }

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

    const { ghostBounds, row, col } = getSnappedPlacement(metrics, piece, clientX, clientY);
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

      queuePreviewFromPoint(event.clientX, event.clientY, drag);
    }
  });

  const handleWindowPointerUp = useEffectEvent((event) => {
    if (!drag) {
      return;
    }

    pickupSoundPlayedRef.current = false;
    previewSoundRef.current.key = null;
    dismissZoneRef.current?.classList.remove("is-hovered");
    cancelQueuedPreview();
    runPreviewAtPoint(event.clientX, event.clientY, drag);
    const pieceId = drag.pieceId;
    const preview = livePreviewRef.current;
    setDrag(null);
    dragBoardMetricsRef.current = null;
    livePreviewRef.current = null;

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

  function startLocalGame() {
    setStartFailed(false);
    nextTrayFetchInFlightRef.current = false;
    setNextTrayPending(false);
    setNextTrayError("");
    setNextTrayRetryTick(0);
    setGame(createGameState(displayedBestScore));
    setStarted(true);
    if (soundEnabled) unlockAndTestSound();
  }

  async function beginNextGame() {
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
    setRunSubmitting(false);
    setRunSubmissionError("");
    setNextTrayPending(false);
    setNextTrayError("");
    setNextTrayRetryTick(0);
    setFinishRunAttempt(0);
    setActiveVerifiedRun(null);
    setStartFailed(false);
    setStarted(false);
    nextTrayFetchInFlightRef.current = false;
    setGame(createGameState(displayedBestScore));

    if (!rankedReady) {
      startLocalGame();
      return;
    }

    setStartPending(true);

    let data, error;

    for (let attempt = 0; attempt < 2; attempt++) {
      ({ data, error } = await supabase.functions.invoke("start-run", {
        body: { clientVersion: CLIENT_VERSION },
      }));
      if (!error && data?.runId && Array.isArray(data?.tray)) break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
    }

    setStartPending(false);

    if (!error && data?.runId && Array.isArray(data?.tray)) {
      setGame(createGameState(displayedBestScore, { ranked: true, tray: data.tray }));
      setActiveVerifiedRun({ id: data.runId, moves: [] });
      setStarted(true);
      if (soundEnabled) unlockAndTestSound();
      return;
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

    setGame((current) => (
      current.selectedPieceId === piece.id
        ? current
        : {
            ...current,
            selectedPieceId: piece.id,
          }
    ));

    dragPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    dragBoardMetricsRef.current = getBoardCellMetrics(boardRef.current);

    const nextDrag = {
      pieceId: piece.id,
    };

    previewSoundRef.current.key = null;
    setDrag(nextDrag);
    queuePreviewFromPoint(event.clientX, event.clientY, nextDrag);
  }

  function handleBoardMove(event) {
    if (!started || !game.selectedPieceId || drag || game.gameOver) {
      return;
    }

    queuePreviewFromPoint(event.clientX, event.clientY);
  }

  function handleBoardLeave() {
    if (!started || drag) {
      return;
    }

    cancelQueuedPreview();
    previewSoundRef.current.key = null;
    livePreviewRef.current = null;
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
    resetProfilePanelState();
    setShowMobileAuthPanel((current) => !current);
  }

  function handleCloseMobileAuthPanel() {
    resetProfilePanelState();
    setShowMobileAuthPanel(false);
  }

  function handleToggleDesktopAuthPanel() {
    resetProfilePanelState();
    setShowDesktopAuthPanel((current) => !current);
  }

  function handleOpenLeaderboard(tab = "personal") {
    resetProfilePanelState();
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

  function handleShowStats() {
    resetProfilePanelState();
    setShowDesktopAuthPanel(false);
    setShowMobileAuthPanel(false);
    setShowStats(true);
  }

  function handleOpenThemes() {
    resetProfilePanelState();
    setShowDesktopAuthPanel(false);
    setShowMobileAuthPanel(false);
    setShowThemeModal(true);
  }

  function handleOpenAuthPrompt() {
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
      setShowThemeModal(false);
      return;
    }
    handleOpenThemes();
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
            aria-label={showMobileAuthPanel ? "Close sign in panel" : "Open sign in panel"}
          >
            <UserIcon />
          </button>
          <ThemeTrigger active={showThemeModal} mobile onClick={handleToggleThemeModal} />
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
              {startHandleMessage ? (
                <PlayerHandleStatus message={startHandleMessage} />
              ) : (
                <PlayerHandle displayName={profile?.display_name ?? null} />
              )}
            </div>
            <div className="desktop-auth-panel">
              <ProfileTrigger active={showDesktopAuthPanel} onClick={handleToggleDesktopAuthPanel} />
              <ThemeTrigger active={showThemeModal} onClick={handleToggleThemeModal} />
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
                  onShowStats={handleShowStats}
                  onSignOut={handleSignOut}
                  onVerifyCode={handleVerifyCode}
                  otpSentTo={otpSentTo}
                  profile={profile}
                  profileLoading={profileLoading}
                  profilePending={profilePending}
                  session={session}
                />
              ) : null}
            </div>
          </aside>

          <section className="playfield">
            <div className="playfield-header">
              <div className="desktop-player-handle">
                {startHandleMessage ? (
                  <PlayerHandleStatus message={startHandleMessage} />
                ) : (
                  <PlayerHandle displayName={profile?.display_name ?? null} />
                )}
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
                  {startFailed ? (
                    <>
                      <p className="start-failed-msg">Couldn't reach GridPop servers.</p>
                      <button className="start-button" type="button" onClick={handleStartGame}>Retry</button>
                      <button className="start-local-button" type="button" onClick={startLocalGame}>Play Locally</button>
                    </>
                  ) : (
                    <button className="start-button" type="button" onClick={handleStartGame} disabled={startBlocked}>
                      {startPending ? "Starting..." : "Start Game"}
                    </button>
                  )}
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
                    <button className="start-button" type="button" onClick={handleRestart} disabled={startPending || (!!session && !accountRunsReadyRef.current)}>
                      {startPending ? "Starting..." : "Play Again"}
                    </button>
                    {runSubmissionError ? (
                      <button
                        className="leaderboard-empty run-submission-retry"
                        type="button"
                        onClick={() => {
                          if (activeVerifiedRun?.id) {
                            runSubmissionInFlightRef.current.delete(activeVerifiedRun.id);
                          }
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
              ) : null}
            </div>
          </section>

          <aside className={`sidebar${drag ? " is-drag-active" : ""}`}>
            <Tray
              tray={game.tray}
              selectedPieceId={game.selectedPieceId}
              gameOver={game.gameOver}
              started={started}
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
            {started && game.awaitingTray ? (
              <button
                className="leaderboard-empty run-submission-retry"
                type="button"
                disabled={nextTrayPending}
                onClick={() => {
                  if (!nextTrayPending) {
                    setNextTrayError("");
                    setNextTrayRetryTick((tick) => tick + 1);
                  }
                }}
              >
                {nextTrayPending ? "Loading next tray..." : nextTrayError || "Loading next tray..."}
              </button>
            ) : null}
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
          <span className="site-footer-version">v1.2</span>
        </footer>

        {showUpdatePrompt ? (
          <div className="update-toast" role="status" aria-live="polite">
            <div className="update-toast-copy">
              <strong>Update Available</strong>
              <span>A newer version of GridPop is ready.</span>
            </div>
            <div className="update-toast-actions">
              <button className="update-toast-button update-toast-button--primary" type="button" onClick={onApplyUpdate}>
                Reload
              </button>
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
              onShowStats={handleShowStats}
              onSignOut={handleSignOut}
              onVerifyCode={handleVerifyCode}
              otpSentTo={otpSentTo}
              profile={profile}
              profileLoading={profileLoading}
              profilePending={profilePending}
              session={session}
            />
          </div>
        </div>
      ) : null}

      {showHowToPlay ? <HowToPlayModal onClose={() => setShowHowToPlay(false)} /> : null}
      {showThemeModal ? (
        <ThemeModal
          activeTheme={activeTheme}
          signedIn={Boolean(session?.user?.id)}
          unlockedThemes={unlockedThemes}
          onGuestSignIn={handleOpenAuthPrompt}
          onSelect={handleThemeSelect}
          onClose={() => setShowThemeModal(false)}
        />
      ) : null}
      {showStats ? (
        <StatsModal
          displayName={profile?.display_name ?? ""}
          onClose={() => setShowStats(false)}
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
