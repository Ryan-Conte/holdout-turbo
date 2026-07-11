// Tiny synthesized sound effects — no assets needed.

let ctx: AudioContext | null = null;
let muted = false;

export function initSfx() {
  if (typeof window === 'undefined') return;
  muted = localStorage.getItem('holdout_muted') === '1';
}

export function isMuted() {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem('holdout_muted', muted ? '1' : '0');
  if (muted) stopAmbient();
  else startAmbient();
  return muted;
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  slideTo?: number,
) {
  const ac = audio();
  if (!ac || vol <= 0.001) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

function noise(dur: number, vol: number) {
  const ac = audio();
  if (!ac || vol <= 0.001) return;
  const buffer = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, ac.currentTime);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

let ambientNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

/** Low wind bed — starts on first user interaction, respects mute. */
export function startAmbient() {
  const ac = audio();
  if (!ac || ambientNodes) return;
  const seconds = 4;
  const buffer = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // brown-ish noise
    last = (last + (Math.random() * 2 - 1) * 0.02) * 0.98;
    data[i] = last * 3;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  const gain = ac.createGain();
  gain.gain.value = 0.05;
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
  ambientNodes = { src, gain };
}

export function stopAmbient() {
  try {
    ambientNodes?.src.stop();
  } catch { /* already stopped */ }
  ambientNodes = null;
}

/** vol 0..1, scale by distance before calling */
export const sfx = {
  shoot(vol = 0.5) {
    tone(190, 0.09, 'square', 0.12 * vol, 60);
    noise(0.07, 0.1 * vol);
  },
  reload() {
    tone(700, 0.05, 'square', 0.07, 500);
    setTimeout(() => tone(420, 0.06, 'square', 0.08, 300), 140);
    setTimeout(() => tone(900, 0.05, 'square', 0.08, 700), 320);
  },
  step() {
    noise(0.03, 0.05);
  },
  zombie(vol = 0.4) {
    tone(90 + Math.random() * 40, 0.5, 'sawtooth', 0.06 * vol, 60);
  },
  howl(vol = 0.4) {
    // rising-then-falling wolf howl
    tone(280, 1.4, 'sine', 0.05 * vol, 420);
    setTimeout(() => tone(420, 1.1, 'sine', 0.045 * vol, 240), 500);
  },
  grunt(vol = 0.4) {
    noise(0.1, 0.12 * vol);
    tone(70, 0.18, 'sawtooth', 0.08 * vol, 45);
  },
  levelUp() {
    tone(520, 0.09, 'triangle', 0.1);
    setTimeout(() => tone(660, 0.09, 'triangle', 0.1), 90);
    setTimeout(() => tone(880, 0.16, 'triangle', 0.11), 180);
  },
  hit(vol = 0.6) {
    tone(320, 0.08, 'square', 0.1 * vol, 140);
  },
  hurt() {
    tone(140, 0.22, 'sawtooth', 0.14, 70);
  },
  chop(vol = 0.6) {
    noise(0.06, 0.16 * vol);
    tone(90, 0.07, 'triangle', 0.14 * vol, 60);
  },
  pickup() {
    tone(520, 0.07, 'triangle', 0.1);
    setTimeout(() => tone(760, 0.09, 'triangle', 0.09), 60);
  },
  craft() {
    tone(420, 0.08, 'triangle', 0.1);
    setTimeout(() => tone(560, 0.08, 'triangle', 0.1), 80);
    setTimeout(() => tone(840, 0.12, 'triangle', 0.1), 160);
  },
  death() {
    tone(220, 0.5, 'sawtooth', 0.16, 40);
  },
};
