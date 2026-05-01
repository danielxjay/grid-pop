let audioContext = null;
let enabled = true;
let warmedUp = false;
let masterGainNode = null;
const clearSoundBufferBanks = new WeakMap();
const CLEAR_SOUND_BANK_SIZE = 10;
const previewMoveBufferBanks = new WeakMap();
const PREVIEW_MOVE_BANK_SIZE = 12;

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

function makeDistortionCurve(amount = 24) {
  const samples = 256;
  const curve = new Float32Array(samples);
  const k = Math.max(0, amount);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
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

function getPreviewMoveBuffers(ctx) {
  let buffers = previewMoveBufferBanks.get(ctx);
  if (!buffers) {
    buffers = Array.from({ length: PREVIEW_MOVE_BANK_SIZE }, () => makeGranular(ctx, 0.04, 0.44));
    previewMoveBufferBanks.set(ctx, buffers);
  }
  return buffers;
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
  getPreviewMoveBuffers(context);
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
  const buffers = getPreviewMoveBuffers(ctx);

  // Quick high crackle — a tiny slice of the clear rip sound
  playNoise(ctx, pickBuffer(buffers), {
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

// Crunch mode wall advance — distorted lower-mid slab grind, separate from padded thuds.
export function playCrunchWallSound() {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;
  const t = startAt;

  const master = getMasterGain(ctx);

  // Short overdriven body: more crushed synth/stone than kick drum.
  const body = ctx.createOscillator();
  body.type = "sawtooth";
  body.frequency.setValueAtTime(92, t);
  body.frequency.exponentialRampToValueAtTime(68, t + 0.18);

  const drive = ctx.createWaveShaper();
  drive.curve = makeDistortionCurve(42);
  drive.oversample = "2x";

  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = "lowpass";
  bodyFilter.frequency.setValueAtTime(780, t);
  bodyFilter.frequency.exponentialRampToValueAtTime(340, t + 0.2);
  bodyFilter.Q.value = 1.1;

  const bodyEnv = ctx.createGain();
  bodyEnv.gain.setValueAtTime(0.0001, t);
  bodyEnv.gain.linearRampToValueAtTime(0.42, t + 0.008);
  bodyEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.23);

  body.connect(drive);
  drive.connect(bodyFilter);
  bodyFilter.connect(bodyEnv);
  bodyEnv.connect(master);
  body.start(t);
  body.stop(t + 0.25);

  // Crushed grit layer gives the "chunk sliding in" texture without reading as a drum hit.
  playNoise(ctx, makeGranular(ctx, 0.18, 0.34), {
    hpf: 75,
    bpf: 270 + Math.random() * 60,
    bpfQ: 0.85,
    lpf: 1050,
    attack: 0.004,
    decay: 0.16,
    gain: 0.46,
    t: t + 0.006,
  });

  playNoise(ctx, makeGranular(ctx, 0.09, 0.52), {
    hpf: 420,
    bpf: 760 + Math.random() * 180,
    bpfQ: 1.4,
    lpf: 1700,
    attack: 0.001,
    decay: 0.07,
    gain: 0.18,
    t: t + 0.018,
  });
}

// Crunch countdown — low race-start beeps, with the final cue jumping higher.
export function playCrunchCountdownSound(count) {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;
  const t = startAt;
  const isFinal = Number(count) <= 1;
  const freq = isFinal ? 520 : 260;
  const duration = isFinal ? 0.16 : 0.12;

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);

  const tone = ctx.createBiquadFilter();
  tone.type = "bandpass";
  tone.frequency.value = freq * 1.05;
  tone.Q.value = isFinal ? 5.5 : 4.2;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(isFinal ? 0.36 : 0.28, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(tone);
  tone.connect(env);
  env.connect(getMasterGain(ctx));
  osc.start(t);
  osc.stop(t + duration + 0.02);

  playNoise(ctx, makeWhiteNoise(ctx, 0.025), {
    hpf: 1200,
    bpf: isFinal ? 2600 : 1700,
    bpfQ: 2.4,
    attack: 0.001,
    decay: 0.018,
    gain: isFinal ? 0.055 : 0.04,
    t,
  });
}

// Critical countdown — tighter, more urgent double-hit cue for each second.
export function playCrunchCriticalCountdownSound(count) {
  if (!enabled) return;
  const { context: ctx, startAt } = getPlayableContext();
  if (!ctx) return;

  const master = getMasterGain(ctx);
  const baseFreq = 330 + Math.max(0, 5 - Number(count)) * 18;
  const hitSpacing = 0.11;

  for (let hit = 0; hit < 2; hit++) {
    const t = startAt + hit * hitSpacing;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.92, t + 0.09);

    const tone = ctx.createBiquadFilter();
    tone.type = "bandpass";
    tone.frequency.value = baseFreq * 1.45;
    tone.Q.value = 6.2;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(hit === 0 ? 0.24 : 0.18, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);

    osc.connect(tone);
    tone.connect(env);
    env.connect(master);
    osc.start(t);
    osc.stop(t + 0.1);

    playNoise(ctx, makeWhiteNoise(ctx, 0.02), {
      hpf: 1500,
      bpf: 2400 + hit * 180,
      bpfQ: 3.1,
      attack: 0.001,
      decay: 0.02,
      gain: hit === 0 ? 0.035 : 0.028,
      t,
    });
  }
}
