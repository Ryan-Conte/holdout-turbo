import type { AnimationClipDef, EntityAnimationState } from '@holdout/shared';

/**
 * Client-side animation timing shared by the game renderer and the
 * /dev/animations QA harness. Everything in this module is presentation-only:
 * it never changes movement, damage or any other authoritative outcome.
 */

/** World speed (px/s) at which a walk clip plays at its authored rate. */
export const STRIDE_REFERENCE_SPEED = 160;
/** Bounds on stride playback rate so extreme speeds stay readable. */
export const STRIDE_MIN_RATE = 0.55;
export const STRIDE_MAX_RATE = 1.9;
/** How long a state-to-state crossfade lasts. */
export const CROSSFADE_MS = 100;

const MIN_KEYFRAME_MS = 16;

export interface ClipSample {
  /** Sprite frame index to draw. */
  frame: number;
  /** Index into the clip's keyframe/frame sequence. */
  step: number;
  /** Completed loops (0 for non-looping clips). */
  cycle: number;
  /** Total duration of one clip cycle in ms. */
  totalMs: number;
  /** Previous sprite frame when the clip requests intra-clip blending. */
  blendFrame?: number;
  /** 0..1 opacity of `frame` over `blendFrame` (1 = no blend needed). */
  blendAlpha: number;
}

export function clipTotalMs(clip: AnimationClipDef | undefined, fallbackMs: number): number {
  if (clip?.keyframes?.length) {
    return clip.keyframes.reduce((sum, keyframe) => sum + Math.max(MIN_KEYFRAME_MS, keyframe.durationMs), 0);
  }
  if (clip?.frames?.length) return clip.frames.length * Math.max(MIN_KEYFRAME_MS, clip.frameMs ?? 125);
  return fallbackMs;
}

/**
 * Deterministic clip sampling. Mirrors the historical renderer behavior
 * (per-entity seed offset on looping non-walk clips, 16 ms keyframe floor)
 * and adds optional short alpha blends across keyframe boundaries for clips
 * that opt in via `blendMs`.
 */
export function sampleClip(
  clip: AnimationClipDef | undefined,
  state: EntityAnimationState,
  elapsedMs: number,
  seed: number,
  reducedMotion = false,
): ClipSample {
  const blendMs = reducedMotion ? 0 : Math.max(0, clip?.blendMs ?? 0);
  if (clip?.keyframes?.length) {
    const keyframes = clip.keyframes;
    const totalMs = clipTotalMs(clip, 0);
    const shifted = Math.max(0, elapsedMs + (clip.loop === false || state === 'walk' ? 0 : seed * 17));
    const phase = clip.loop === false ? Math.min(totalMs - 1, shifted) : shifted % totalMs;
    let elapsed = 0;
    let at = keyframes.length - 1;
    let stepStart = 0;
    for (let index = 0; index < keyframes.length; index++) {
      const duration = Math.max(MIN_KEYFRAME_MS, keyframes[index].durationMs);
      if (phase < elapsed + duration) { at = index; stepStart = elapsed; break; }
      elapsed += duration;
      stepStart = elapsed;
    }
    const cycle = clip.loop === false ? 0 : Math.floor(shifted / totalMs);
    const intoStep = phase - stepStart;
    const hasPrevious = at > 0 || clip.loop !== false;
    // Strikes must land hard: never soften the entry into an impact pose.
    const snapStep = keyframes[at].event === 'impact';
    const blendAlpha = blendMs > 0 && hasPrevious && !snapStep && intoStep < blendMs ? 0.5 + (intoStep / blendMs) * 0.5 : 1;
    const previousIndex = at > 0 ? at - 1 : keyframes.length - 1;
    return {
      frame: Math.max(0, keyframes[at].frame),
      step: at,
      cycle,
      totalMs,
      blendFrame: blendAlpha < 1 ? Math.max(0, keyframes[previousIndex].frame) : undefined,
      blendAlpha,
    };
  }
  const sequence = clip?.frames?.length ? clip.frames : state === 'walk' ? [0, 1] : [0];
  const frameMs = Math.max(MIN_KEYFRAME_MS, clip?.frameMs ?? 125);
  const phaseMs = clip?.loop === false || state === 'walk' ? Math.max(0, elapsedMs) : Math.max(0, elapsedMs + seed * 17);
  const step = Math.floor(phaseMs / frameMs);
  const at = clip?.loop === false ? Math.min(sequence.length - 1, step) : step % sequence.length;
  const intoStep = phaseMs - step * frameMs;
  const hasPrevious = at > 0 || clip?.loop !== false;
  const blendAlpha = blendMs > 0 && hasPrevious && intoStep < blendMs ? 0.5 + (intoStep / blendMs) * 0.5 : 1;
  const previousIndex = at > 0 ? at - 1 : sequence.length - 1;
  return {
    frame: Math.max(0, sequence[at] ?? 0),
    step: at,
    cycle: clip?.loop === false ? 0 : Math.floor(phaseMs / (frameMs * sequence.length)),
    totalMs: frameMs * sequence.length,
    blendFrame: blendAlpha < 1 ? Math.max(0, sequence[previousIndex] ?? 0) : undefined,
    blendAlpha,
  };
}

export interface AnimatorPlan {
  state: EntityAnimationState;
  /** Elapsed ms to sample the active clip with (stride time for walk). */
  elapsedMs: number;
  /** 0..1 fraction through the current stride cycle (walk bob/sway sync). */
  strideCycle: number;
  /** Crossfade source drawn under the active state, when one is running. */
  fade?: { state: EntityAnimationState; elapsedMs: number; alpha: number };
}

/** States that should never be entered through a softening crossfade. */
const SNAP_INTO: ReadonlySet<EntityAnimationState> = new Set(['hit', 'death', 'attack', 'punch']);

/**
 * Per-entity animation bookkeeping: speed-scaled stride time so footfalls
 * track actual ground motion, and short crossfades when a state ends.
 */
export class EntityAnimator {
  lastUsedAt = 0;
  private strideMs = 0;
  private strideTotalMs = 440;
  private state: EntityAnimationState | null = null;
  private stateStartedAt = 0;
  private fadeState: EntityAnimationState | null = null;
  private fadeElapsedMs = 0;
  private fadeStrideCycle = 0;

  update(
    nowMs: number,
    dtMs: number,
    state: EntityAnimationState,
    elapsedMs: number,
    speed: number,
    walkTotalMs: number,
    reducedMotion = false,
  ): AnimatorPlan {
    this.lastUsedAt = nowMs;
    this.strideTotalMs = Math.max(120, walkTotalMs);
    if (state === 'walk') {
      const rate = Math.min(STRIDE_MAX_RATE, Math.max(STRIDE_MIN_RATE, speed / STRIDE_REFERENCE_SPEED));
      this.strideMs += Math.max(0, dtMs) * rate;
    }

    if (this.state !== state) {
      const previous = this.state;
      if (
        previous !== null
        && !reducedMotion
        && !SNAP_INTO.has(state)
      ) {
        this.fadeState = previous;
        this.fadeElapsedMs = previous === 'walk' ? this.strideMs : nowMs - this.stateStartedAt;
        this.fadeStrideCycle = this.currentStrideCycle();
      } else {
        this.fadeState = null;
      }
      this.state = state;
      this.stateStartedAt = nowMs;
      // Fresh walks begin at a planted contact so starts look deliberate.
      if (state === 'walk') this.strideMs = 0;
    }

    const stateAge = nowMs - this.stateStartedAt;
    let fade: AnimatorPlan['fade'];
    if (this.fadeState !== null) {
      if (stateAge >= CROSSFADE_MS) this.fadeState = null;
      else {
        fade = {
          state: this.fadeState,
          elapsedMs: this.fadeElapsedMs,
          alpha: 1 - stateAge / CROSSFADE_MS,
        };
      }
    }

    return {
      state,
      elapsedMs: state === 'walk' ? this.strideMs : elapsedMs,
      strideCycle: this.currentStrideCycle(),
      fade,
    };
  }

  private currentStrideCycle(): number {
    const cycle = (this.strideMs % this.strideTotalMs) / this.strideTotalMs;
    return cycle < 0 ? cycle + 1 : cycle;
  }
}

/** Prune animator entries that have not been drawn recently. */
export function pruneAnimators(animators: Map<string, EntityAnimator>, nowMs: number, maxAgeMs = 10_000) {
  for (const [id, animator] of animators) {
    if (nowMs - animator.lastUsedAt > maxAgeMs) animators.delete(id);
  }
}

export interface MotionPoseInput {
  moving: boolean;
  /** Client clock in seconds (idle sway phase). */
  time: number;
  seed: number;
  vx: number;
  vy: number;
  hitElapsedMs?: number;
  /** 0..1 stride cycle from the animator; syncs bob with footfalls. */
  strideCycle?: number;
  /** Seconds since the moving/idle flag last flipped. */
  transitionAgeS: number;
  reducedMotion?: boolean;
}

export interface MotionPose {
  x: number;
  y: number;
  shadowScale: number;
  lean: number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Procedural secondary motion layered on top of the sprite frames: bob and
 * sway synchronized to the stride cycle, start lean, stop settle, hit shake.
 */
export function computeMotionPose(input: MotionPoseInput): MotionPose {
  const {
    moving, time, seed, vx, vy,
    hitElapsedMs = Infinity,
    strideCycle,
    transitionAgeS,
    reducedMotion = false,
  } = input;
  if (reducedMotion) {
    const hitShake = hitElapsedMs < 150 ? Math.sin(hitElapsedMs * 0.13) * (1 - hitElapsedMs / 150) : 0;
    return { x: hitShake, y: 0, shadowScale: 1, lean: 0 };
  }
  const speed = Math.hypot(vx, vy);
  const moveBlend = moving ? easeOutCubic(Math.min(1, transitionAgeS / 0.14)) : 0;
  // Two bob peaks per stride cycle, lowest at each planted contact.
  const cyclePhase = strideCycle !== undefined
    ? strideCycle * Math.PI * 2
    : time * Math.min(17, 12.5 + speed * 0.02);
  const stride = Math.sin(cyclePhase);
  const bob = moving
    ? (1 - Math.cos(cyclePhase * 2)) * 0.68 * moveBlend
    : Math.sin(time * 2.1 + (seed % 211) * 0.07) * 0.2;
  const sway = moving ? stride * 0.55 * moveBlend : 0;
  const startLean = moving && transitionAgeS < 0.18
    ? Math.sin((transitionAgeS / 0.18) * Math.PI) * 0.026
    : 0;
  const stopSettle = !moving && transitionAgeS < 0.22
    ? Math.sin((transitionAgeS / 0.22) * Math.PI * 2) * (1 - transitionAgeS / 0.22) * 0.7
    : 0;
  const hitShake = hitElapsedMs < 180 ? Math.sin(hitElapsedMs * 0.12) * (1 - hitElapsedMs / 180) * 1.8 : 0;
  const directionLean = moving && speed > 1
    ? Math.max(-0.025, Math.min(0.025, vx / 5000)) * moveBlend
    : 0;
  return {
    x: sway + hitShake,
    y: -bob + stopSettle,
    shadowScale: Math.max(0.86, 1 - bob * 0.045),
    lean: startLean * Math.sign(vx || Math.cos(cyclePhase)) + directionLean,
  };
}

/**
 * Forward body displacement (in px, along the facing angle) during a strike:
 * a slight pull back through the windup, a committed lunge at impact, then a
 * settle back to neutral. Progress is 0..1 through the attack clip.
 */
export function attackLungePx(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) return 0;
  if (progress < 0.3) return -2.2 * easeOutCubic(progress / 0.3);
  if (progress < 0.55) {
    const t = (progress - 0.3) / 0.25;
    return -2.2 + 6.4 * easeOutCubic(t);
  }
  return 4.2 * (1 - easeOutCubic((progress - 0.55) / 0.45));
}
