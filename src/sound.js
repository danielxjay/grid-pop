let audioContext = null;
let enabled = true;
let warmedUp = false;
let masterGainNode = null;
const clearSoundBufferBanks = new WeakMap();
const CLEAR_SOUND_BANK_SIZE = 10;

let volume = (() => {
  try {
    const stored = localStorage.getItem("gridpop-volume");
    if (stored === null) return 1;
    const v = Number(stored);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
  } catch { return 1; }
})();

// --- Audio context ---

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (audioContext === null) audioContext = new Ctor();
  return audioContext;
}

function getMasterGain(ctx) {
  if (!masterGainNode || masterGainNode.context !== ctx) {
    masterGainNode = ctx.createGain();
    masterGainNode.gain.value = volume;
    masterGainNode.connect(ctx.destination);
  }
  return masterGainNode;
}

function getPlayableContext() {
  const context = getAudioContext();
  if (!context) return { context: null, startAt: 0 };
  const startAt = context.currentTime + (context.state === "running" ? 0.004 : 0.06);
  if (context.state === "suspended") context.resume().catch(() => {});
  return { context, startAt };
}

// --- Buffer generators ---

function makeWhiteNoise(ctx, duration) {
  const len = Math.ceil(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  return buf;
}

// Sparse random impulses — simulates granular crunch (snow, fabric)
function makeGranular(ctx, duration, density) {
  const len = Math.ceil(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    ch[i] = Math.random() < density ? Math.random() * 2 - 1 : 0;
  }
  return buf;
}

// Dense crackle with occasional bigger pops — simulates velcro / honeycomb
function makeVelcro(ctx, duration) {
  const len = Math.ceil(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const crackle = Math.random() < 0.38 ? Math.random() * 2 - 1 : 0;
    const pop = Math.random() < 0.02 ? (Math.random() * 2 - 1) * 3 : 0;
    ch[i] = crackle + pop;
  }
  return buf;
}

function pickBuffer(buffers) {
  return buffers[Math.floor(Math.random() * buffers.length)];
}

function getClearSoundBuffers(ctx) {
  let banks = clearSoundBufferBanks.get(ctx);
  if (!banks) {
    banks = {
      shortVelcro: Array.from({ length: CLEAR_SOUND_BANK_SIZE }, () => makeVelcro(ctx, 0.16)),
      peelVelcro: Array.from({ length: CLEAR_SOUND_BANK_SIZE }, () => makeVelcro(ctx, 0.09)),
      midGranular: Array.from({ length: CLEAR_SOUND_BANK_SIZE }, () => makeGranular(ctx, 0.08, 0.28)),
      peelGranular: Array.from({ length: CLEAR_SOUND_BANK_SIZE }, () => makeGranular(ctx, 0.11, 0.48)),
    };
    clearSoundBufferBanks.set(ctx, banks);
  }
  return banks;
}

// --- Core noise player ---
// Routes buffer through optional HPF → BPF → LPF → gain envelope → master gain

function playNoise(ctx, buffer, { hpf, bpf, bpfQ = 1, lpf, attack, decay, gain, t }) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const chain = [src];

  if (hpf) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hpf;
    chain.push(f);
  }

  if (bpf) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = bpf;
    f.Q.value = bpfQ;
    chain.push(f);
  }

  if (lpf) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lpf;
    chain.push(f);
  }

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  chain.push(env);

  for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
  chain[chain.length - 1].connect(getMasterGain(ctx));

  src.start(t);
  src.stop(t + attack + decay + 0.02);
}

// --- Exports ---

export function primeSound() {
  const { context } = getPlayableContext();
  if (!context || warmedUp) return;
  const now = context.currentTime + 0.001;
  const osc = context.createOscillator();
  const gain = context.createGain();
  getClearSoundBuffers(context);
  osc.frequency.value = 220;
  gain.gain.setValueAtTime(0.00001, now);
  gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.03);
  osc.connect(gain);
  gain.connect(getMasterGain(context));
  osc.start(now);
  osc.stop(now + 0.03);
  warmedUp = true;
}

export function isSoundEnabled() {
  return enabled;
}

export function getSoundVolume() {
  return volume;
}

export function setSoundEnabled(nextEnabled) {
  enabled = nextEnabled;
  if (enabled) {
    warmedUp = false;
    primeSound();
  }
}

export function setSoundVolume(nextVolume) {
  volume = Math.max(0, Math.min(1, nextVolume));
  if (masterGainNode) {
    masterGainNode.gain.value = volume;
  }
}

export function unlockAndTestSound() {
  if (!enabled) enabled = true;
  primeSound();
  window.setTimeout(() => {
    playPickupSound();
  }, 40);
}

// Soft padded thud — picking up a piece
export function playPickupSound() {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;
  const t = startAt;

  // Low sine thud — the main body
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(145, t);
  osc.frequency.exponentialRampToValueAtTime(62, t + 0.11);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.52, t + 0.009);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  osc.connect(env);
  env.connect(getMasterGain(ctx));
  osc.start(t);
  osc.stop(t + 0.14);

  // Muffled low noise — soft padded texture
  playNoise(ctx, makeWhiteNoise(ctx, 0.1), {
    lpf: 380,
    bpf: 210,
    bpfQ: 0.7,
    attack: 0.006,
    decay: 0.075,
    gain: 0.22,
    t,
  });
}

// Padded drop thud — same family as pickup, slightly heavier landing
export function playPlaceSound() {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;
  const t = startAt;

  // Low sine thud — a touch lower and slower than pickup
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(125, t);
  osc.frequency.exponentialRampToValueAtTime(52, t + 0.13);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.58, t + 0.011);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(env);
  env.connect(getMasterGain(ctx));
  osc.start(t);
  osc.stop(t + 0.18);

  // Muffled low noise — same padded texture, slightly denser
  playNoise(ctx, makeWhiteNoise(ctx, 0.12), {
    lpf: 420,
    bpf: 200,
    bpfQ: 0.7,
    attack: 0.007,
    decay: 0.09,
    gain: 0.26,
    t,
  });
}

// Sticky honeycomb — muffled sporadic crackle bursts
export function playClearSound() {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;
  const buffers = getClearSoundBuffers(ctx);

  // Random number of bursts with randomised timing, pitch and intensity
  const burstCount = 3 + Math.floor(Math.random() * 3); // 3–5 bursts
  let t = startAt;

  for (let p = 0; p < burstCount; p++) {
    if (p > 0) t += 0.022 + Math.random() * 0.055; // 22–77ms sporadic gap

    const amp = 0.45 + Math.random() * 0.38;            // random intensity
    const bpfFreq = 550 + Math.random() * 550;           // 550–1100Hz muffled body
    const decayTime = 0.055 + Math.random() * 0.06;      // variable length

    // Muffled sticky body (low-passed to keep it dull and chewy)
    playNoise(ctx, pickBuffer(buffers.shortVelcro), {
      hpf: 180,
      bpf: bpfFreq,
      bpfQ: 1.4 + Math.random() * 0.8,
      lpf: 2800,
      attack: 0.003,
      decay: decayTime,
      gain: amp,
      t,
    });

    // Subtle mid crackle only (no ultra-highs — keeps it muffled)
    if (Math.random() > 0.35) {
      playNoise(ctx, pickBuffer(buffers.midGranular), {
        hpf: 1200,
        bpf: 2400 + Math.random() * 800,
        bpfQ: 1.6,
        lpf: 4000,
        attack: 0.002,
        decay: decayTime * 0.7,
        gain: amp * 0.32,
        t: t + 0.004 + Math.random() * 0.01,
      });
    }
  }

  // Sticker-peel layer — fast high crackle rip sitting on top of the muffled base
  // Two quick bursts: the initial peel grab then the adhesive release
  playNoise(ctx, pickBuffer(buffers.peelGranular), {
    hpf: 2800,
    bpf: 4800,
    bpfQ: 2.6,
    attack: 0.001,
    decay: 0.07,
    gain: 0.52,
    t: startAt + 0.008,
  });

  playNoise(ctx, pickBuffer(buffers.peelVelcro), {
    hpf: 3500,
    bpf: 6000,
    bpfQ: 3.2,
    attack: 0.001,
    decay: 0.055,
    gain: 0.38,
    t: startAt + 0.038 + Math.random() * 0.02,
  });
}

// Single velcro pop — one burst of the row-clear sound, for popping individual pixels
export function playPixelPopSound() {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;
  const t = startAt;

  const amp = 0.48 + Math.random() * 0.34;
  const bpfFreq = 580 + Math.random() * 480;
  const decayTime = 0.052 + Math.random() * 0.05;

  playNoise(ctx, makeVelcro(ctx, decayTime + 0.04), {
    hpf: 180,
    bpf: bpfFreq,
    bpfQ: 1.4 + Math.random() * 0.8,
    lpf: 2800,
    attack: 0.003,
    decay: decayTime,
    gain: amp,
    t,
  });

  playNoise(ctx, makeGranular(ctx, 0.08, 0.46), {
    hpf: 2800,
    bpf: 4800,
    bpfQ: 2.6,
    attack: 0.001,
    decay: 0.058,
    gain: 0.44,
    t: t + 0.007,
  });
}

// Mini sticker-crackle — dragged piece moving over board positions
export function playPreviewMoveSound() {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;
  const t = startAt;

  // Quick high crackle — a tiny slice of the clear rip sound
  playNoise(ctx, makeGranular(ctx, 0.04, 0.44), {
    hpf: 2600,
    bpf: 4600,
    bpfQ: 2.6,
    attack: 0.001,
    decay: 0.022,
    gain: 0.28,
    t,
  });
}

// Clunky fill click — each cell popping in during game-over animation
export function playFillCellSound() {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;
  const t = startAt;

  // Short low blip with slight random pitch so rapid fills don't all sound identical
  const freq = 110 + Math.random() * 90;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.48, t + 0.042);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.38, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);
  osc.connect(env);
  env.connect(getMasterGain(ctx));
  osc.start(t);
  osc.stop(t + 0.055);

  // Small woody knock to give it a clunky block-dropping character
  playNoise(ctx, makeWhiteNoise(ctx, 0.04), {
    lpf: 700,
    bpf: 320,
    bpfQ: 2.2,
    attack: 0.001,
    decay: 0.032,
    gain: 0.22,
    t,
  });
}
