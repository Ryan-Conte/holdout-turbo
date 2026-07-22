import type { SoundDocument } from '@holdout/shared';

let ctx: AudioContext | null = null;
let muted = false;
let engineSounds: SoundDocument = { presets: {}, actions: {} };

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

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
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

function noise(dur: number, vol: number, filterHz = 2400) {
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
  filter.frequency.value = filterHz;
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

function configured(actionOrPreset: string, vol = 1): boolean {
  const presetId = engineSounds.actions[actionOrPreset] ?? actionOrPreset;
  const preset = engineSounds.presets[presetId];
  if (!preset) return false;
  const volume = Math.max(0, Math.min(1, vol)) * preset.volume;
  tone(preset.frequency, preset.durationMs / 1000, preset.wave, volume, preset.endFrequency);
  if (preset.noise > 0) noise(preset.durationMs / 1000, preset.noise * volume, preset.filterHz);
  return true;
}

type AmbientGraph = {
  master: GainNode;
  sources: Array<AudioBufferSourceNode | OscillatorNode>;
};

let ambientNodes: AmbientGraph | null = null;
// Keep the wind/rumble bed well behind footsteps, creatures and combat cues.
const AMBIENT_MASTER_GAIN = 0.38;

function ambientNoise(ac: AudioContext, seconds: number, channels: number, smoothing: number, drive: number) {
  const buffer = ac.createBuffer(channels, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    let value = 0;
    for (let i = 0; i < data.length; i++) {
      value = value * smoothing + (Math.random() * 2 - 1) * (1 - smoothing);
      data[i] = Math.max(-1, Math.min(1, value * drive));
    }
  }
  return buffer;
}

export function startAmbient() {
  const ac = audio();
  if (!ac || ambientNodes) return;

  const now = ac.currentTime;
  const master = ac.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(AMBIENT_MASTER_GAIN, now + 1.8);
  master.connect(ac.destination);

  // A wide, gently moving wind layer keeps the open world from feeling
  // digitally silent without masking footsteps or distant combat cues.
  const wind = ac.createBufferSource();
  wind.buffer = ambientNoise(ac, 9.7, 2, 0.88, 2.2);
  wind.loop = true;
  const windHighpass = ac.createBiquadFilter();
  windHighpass.type = 'highpass';
  windHighpass.frequency.value = 70;
  const windLowpass = ac.createBiquadFilter();
  windLowpass.type = 'lowpass';
  windLowpass.frequency.value = 1050;
  windLowpass.Q.value = 0.55;
  const windGain = ac.createGain();
  windGain.gain.value = 0.055;
  wind.connect(windHighpass).connect(windLowpass).connect(windGain).connect(master);

  // A quieter low-frequency bed gives the ambience weight on headphones and
  // small speakers. Its mismatched loop length prevents an obvious repetition.
  const rumble = ac.createBufferSource();
  rumble.buffer = ambientNoise(ac, 7.1, 1, 0.992, 7.5);
  rumble.loop = true;
  const rumbleFilter = ac.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 210;
  const rumbleGain = ac.createGain();
  rumbleGain.gain.value = 0.032;
  rumble.connect(rumbleFilter).connect(rumbleGain).connect(master);

  // Very slow modulation creates soft gusts instead of a fixed noise floor.
  const gust = ac.createOscillator();
  gust.type = 'sine';
  gust.frequency.value = 0.065;
  const gustDepth = ac.createGain();
  gustDepth.gain.value = 0.016;
  gust.connect(gustDepth).connect(windGain.gain);

  wind.start(now);
  rumble.start(now);
  gust.start(now);
  ambientNodes = { master, sources: [wind, rumble, gust] };
}

export function stopAmbient() {
  const graph = ambientNodes;
  if (!graph) return;
  ambientNodes = null;
  const ac = ctx;
  const now = ac?.currentTime ?? 0;
  graph.master.gain.cancelScheduledValues(now);
  graph.master.gain.setValueAtTime(Math.max(0.0001, graph.master.gain.value), now);
  graph.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  for (const source of graph.sources) {
    try { source.stop(now + 0.3); } catch { /* already stopped */ }
  }
  window.setTimeout(() => graph.master.disconnect(), 350);
}

export const sfx = {
  applyContent(content?: SoundDocument) {
    engineSounds = content ?? { presets: {}, actions: {} };
  },
  play(actionOrPreset: string, vol = 1) {
    configured(actionOrPreset, vol);
  },
  shoot(vol = 0.5) {
    if (configured('shoot', vol)) return;
    tone(190, 0.09, 'square', 0.12 * vol, 60); noise(0.07, 0.1 * vol);
  },
  reload() {
    if (configured('reload')) return;
    tone(700, 0.05, 'square', 0.07, 500);
    setTimeout(() => tone(420, 0.06, 'square', 0.08, 300), 140);
    setTimeout(() => tone(900, 0.05, 'square', 0.08, 700), 320);
  },
  step() { if (!configured('step')) noise(0.03, 0.05); },
  zombie(vol = 0.4) { if (!configured('zombie', vol)) tone(90 + Math.random() * 40, 0.5, 'sawtooth', 0.06 * vol, 60); },
  howl(vol = 0.4) {
    if (configured('howl', vol)) return;
    tone(280, 1.4, 'sine', 0.05 * vol, 420);
    setTimeout(() => tone(420, 1.1, 'sine', 0.045 * vol, 240), 500);
  },
  grunt(vol = 0.4) {
    if (configured('grunt', vol)) return;
    noise(0.1, 0.12 * vol); tone(70, 0.18, 'sawtooth', 0.08 * vol, 45);
  },
  levelUp() {
    if (configured('level_up')) return;
    tone(520, 0.09, 'triangle', 0.1);
    setTimeout(() => tone(660, 0.09, 'triangle', 0.1), 90);
    setTimeout(() => tone(880, 0.16, 'triangle', 0.11), 180);
  },
  hit(vol = 0.6) { if (!configured('hit', vol)) tone(320, 0.08, 'square', 0.1 * vol, 140); },
  hurt() { if (!configured('hurt')) tone(140, 0.22, 'sawtooth', 0.14, 70); },
  chop(vol = 0.6) {
    if (configured('chop', vol)) return;
    noise(0.06, 0.16 * vol); tone(90, 0.07, 'triangle', 0.14 * vol, 60);
  },
  pickup() {
    if (configured('pickup')) return;
    tone(520, 0.07, 'triangle', 0.1); setTimeout(() => tone(760, 0.09, 'triangle', 0.09), 60);
  },
  craft() {
    if (configured('craft')) return;
    tone(420, 0.08, 'triangle', 0.1);
    setTimeout(() => tone(560, 0.08, 'triangle', 0.1), 80);
    setTimeout(() => tone(840, 0.12, 'triangle', 0.1), 160);
  },
  death() { if (!configured('death')) tone(220, 0.5, 'sawtooth', 0.16, 40); },
};
