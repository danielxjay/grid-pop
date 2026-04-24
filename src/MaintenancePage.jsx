import { useState, useEffect, useRef } from "react";
import { MAINTENANCE_COPY } from "./maintenance.js";
import {
  isSoundEnabled,
  setSoundEnabled,
  unlockAndTestSound,
  playFillCellSound,
  playPixelPopSound,
} from "./sound.js";

const TONES = ["coral", "gold", "mint", "sky"];
const SPLASH_ROTATIONS = [0, 72, 144, 216, 288];
const SPLASH_DURATION_MS = 480;
const POP_DURATION_MS = 360;
const RESPAWN_DELAY_MS = 500;
const BUMP_COOLDOWN_MS = 100;

function getPixelConfig() {
  const mobile = window.innerWidth < 500;
  return { count: mobile ? 8 : 18, speed: mobile ? 75 : 110 };
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

function spawnSplash(x, y, size, tone) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const particles = SPLASH_ROTATIONS.map((rot) => {
    const el = document.createElement("div");
    el.className = `tone-${tone}`;
    el.style.cssText = [
      "position:fixed",
      `left:${cx}px`,
      `top:${cy}px`,
      "width:3px",
      "height:3px",
      "border-radius:999px",
      "pointer-events:none",
      "transform-origin:center center",
      "z-index:10",
      `--tone-fill:var(--tone-${tone}-lo)`,
      `--splash-rotation:${rot}deg`,
      `animation:bubbleSplash ${SPLASH_DURATION_MS}ms ease-out both`,
    ].join(";");
    document.body.appendChild(el);
    return el;
  });
  setTimeout(() => { for (const el of particles) el.remove(); }, SPLASH_DURATION_MS + 50);
}

function randomSign() { return Math.random() > 0.5 ? 1 : -1; }
function randomTone() { return TONES[Math.floor(Math.random() * TONES.length)]; }
function randomVelocity(speed) { return randomSign() * speed * (0.75 + Math.random() * 0.5); }

function FloatingPixels({ soundEnabledRef }) {
  const { count: pixelCount, speed } = useRef(getPixelConfig()).current;
  const pixelRefs = useRef([]);
  const stateRef = useRef(null);
  const rafRef = useRef(null);
  const pixelSizeRef = useRef(40);
  const respawnTimerRef = useRef(null);

  function respawnAll() {
    const state = stateRef.current;
    if (!state) return;
    const ps = pixelSizeRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const p of state) {
      p.x = ps + Math.random() * (vw - ps * 2);
      p.y = ps + Math.random() * (vh - ps * 2);
      p.vx = randomVelocity(speed);
      p.vy = randomVelocity(speed);
      p.tone = randomTone();
      p.active = true;
      const el = pixelRefs.current[p.id];
      if (el) {
        el.className = `maintenance-pixel tone-${p.tone} is-spawning`;
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        el.style.visibility = "visible";
        setTimeout(() => { if (el) el.classList.remove("is-spawning"); }, 220);
      }
    }
  }

  useEffect(() => {
    const ps = pixelRefs.current[0]?.offsetWidth || 40;
    pixelSizeRef.current = ps;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    stateRef.current = Array.from({ length: pixelCount }, (_, id) => ({
      id,
      x: ps + Math.random() * (vw - ps * 2),
      y: ps + Math.random() * (vh - ps * 2),
      vx: randomVelocity(speed),
      vy: randomVelocity(speed),
      tone: randomTone(),
      active: true,
      lastBumpTime: 0,
    }));

    for (const p of stateRef.current) {
      const el = pixelRefs.current[p.id];
      if (el) {
        el.className = `maintenance-pixel tone-${p.tone}`;
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
      }
    }

    let lastTime = performance.now();

    function tick(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const state = stateRef.current;
      const psize = pixelSizeRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const half = psize / 2;
      const soundOn = soundEnabledRef.current;

      for (const p of state) {
        if (!p.active) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        let hit = false;
        if (p.x <= 0) { p.x = 0; p.vx = Math.abs(p.vx); hit = true; }
        if (p.x >= vw - psize) { p.x = vw - psize; p.vx = -Math.abs(p.vx); hit = true; }
        if (p.y <= 0) { p.y = 0; p.vy = Math.abs(p.vy); hit = true; }
        if (p.y >= vh - psize) { p.y = vh - psize; p.vy = -Math.abs(p.vy); hit = true; }
        if (hit && soundOn && now - p.lastBumpTime > BUMP_COOLDOWN_MS) {
          playFillCellSound();
          p.lastBumpTime = now;
        }
      }

      for (let i = 0; i < state.length; i++) {
        for (let j = i + 1; j < state.length; j++) {
          const a = state[i];
          const b = state[j];
          if (!a.active || !b.active) continue;
          const dx = (b.x + half) - (a.x + half);
          const dy = (b.y + half) - (a.y + half);
          const distSq = dx * dx + dy * dy;
          if (distSq > 0 && distSq < psize * psize) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const ny = dy / dist;
            const dot = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (dot < 0) {
              a.vx += dot * nx; a.vy += dot * ny;
              b.vx -= dot * nx; b.vy -= dot * ny;
              if (soundOn && now - a.lastBumpTime > BUMP_COOLDOWN_MS && now - b.lastBumpTime > BUMP_COOLDOWN_MS) {
                playFillCellSound();
                a.lastBumpTime = now;
                b.lastBumpTime = now;
              }
            }
            const overlap = (psize - dist) / 2;
            a.x -= overlap * nx; a.y -= overlap * ny;
            b.x += overlap * nx; b.y += overlap * ny;
          }
        }
      }

      for (const p of state) {
        if (!p.active) continue;
        const el = pixelRefs.current[p.id];
        if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(respawnTimerRef.current);
    };
  }, [pixelCount, soundEnabledRef, speed]);

  function handlePop(id) {
    const state = stateRef.current;
    if (!state) return;
    const p = state[id];
    if (!p || !p.active) return;
    p.active = false;

    const el = pixelRefs.current[id];
    const ps = pixelSizeRef.current;

    if (el) {
      el.classList.add("is-popping");
      spawnSplash(p.x, p.y, ps, p.tone);
    }

    if (soundEnabledRef.current) playPixelPopSound();

    setTimeout(() => {
      if (el) {
        el.classList.remove("is-popping");
        el.style.visibility = "hidden";
      }
      if (stateRef.current?.every((px) => !px.active)) {
        respawnTimerRef.current = setTimeout(respawnAll, RESPAWN_DELAY_MS);
      }
    }, POP_DURATION_MS);
  }

  return (
    <div className="maintenance-pixels" aria-hidden="true">
      {Array.from({ length: pixelCount }, (_, id) => (
        <button
          key={id}
          ref={(el) => { pixelRefs.current[id] = el; }}
          type="button"
          tabIndex={-1}
          className={`maintenance-pixel tone-${TONES[id % TONES.length]}`}
          onClick={() => handlePop(id)}
        />
      ))}
    </div>
  );
}

export default function MaintenancePage() {
  const [soundEnabled, setSoundEnabledState] = useState(() => isSoundEnabled());
  const soundEnabledRef = useRef(soundEnabled);

  function handleToggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setSoundEnabledState(next);
    soundEnabledRef.current = next;
    if (next) unlockAndTestSound();
  }

  return (
    <div className="maintenance-page">
      <FloatingPixels soundEnabledRef={soundEnabledRef} />
      <div className="maintenance-content">
        <h1>GridPop!</h1>
        <div className="maintenance-card">
          <p className="maintenance-eyebrow">{MAINTENANCE_COPY.eyebrow}</p>
          <h2 className="maintenance-title">{MAINTENANCE_COPY.title}</h2>
          <p className="maintenance-body">{MAINTENANCE_COPY.body}</p>
          <p className="maintenance-note">{MAINTENANCE_COPY.note}</p>
          <button
            className="start-button"
            type="button"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
        </div>
      </div>
      <button
        className="sound-icon-button maintenance-sound-button"
        type="button"
        onClick={handleToggleSound}
        aria-label={soundEnabled ? "Mute sound" : "Enable sound"}
      >
        <SpeakerIcon on={soundEnabled} />
      </button>
    </div>
  );
}
