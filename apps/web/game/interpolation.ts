import type { StateSnap } from '@holdout/shared';

export const REMOTE_INTERPOLATION_DELAY_MS = 85;
export const LOCAL_RECONCILE_DEAD_ZONE = 2;
export const LOCAL_RECONCILE_RATE = 8;
const MAX_EXTRAPOLATION_MS = 50;
const MAX_PROJECTILE_EXTRAPOLATION_MS = 75;
const MAX_SAMPLE_AGE_MS = 750;
const TELEPORT_DISTANCE = 200;

/**
 * Input acknowledgements arrive on the next simulation snapshot, so their
 * measured round trip includes roughly half a server tick of queueing. Remove
 * that scheduling time before estimating how far ahead the local presentation
 * should be. In particular, do not invent movement lead on a local relay.
 */
export function estimateNetworkLeadMs(acknowledgementMs: number | null, tickMs: number): number {
  if (acknowledgementMs === null || !Number.isFinite(acknowledgementMs)) return 0;
  const networkRoundTripMs = Math.max(0, acknowledgementMs - tickMs / 2);
  return Math.min(150, networkRoundTripMs / 2);
}

export interface MotionPoint {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

export interface MotionVector extends MotionPoint {
  vx: number;
  vy: number;
}

export interface MotionSample {
  at: number;
  players: Map<string, MotionPoint>;
  enemies: Map<string, MotionPoint>;
  projectiles: Map<number, MotionPoint>;
}

type MotionGroup = 'players' | 'enemies' | 'projectiles';

export function captureMotionSample(state: StateSnap, at: number): MotionSample {
  return {
    at,
    players: new Map(state.players.map((entity) => [entity.id, { x: entity.x, y: entity.y }])),
    enemies: new Map(state.enemies.map((entity) => [entity.id, { x: entity.x, y: entity.y }])),
    projectiles: new Map(state.projectiles.map((entity) => [entity.id, {
      x: entity.x,
      y: entity.y,
      vx: entity.vx,
      vy: entity.vy,
    }])),
  };
}

export function appendMotionSample(samples: MotionSample[], sample: MotionSample): MotionSample[] {
  const oldest = sample.at - MAX_SAMPLE_AGE_MS;
  return [...samples, sample].filter((entry) => entry.at >= oldest).slice(-20);
}

export function sampleMotion(
  samples: readonly MotionSample[],
  group: 'players' | 'enemies',
  id: string,
  renderAt: number,
): MotionVector | undefined;
export function sampleMotion(
  samples: readonly MotionSample[],
  group: 'projectiles',
  id: number,
  renderAt: number,
): MotionVector | undefined;
export function sampleMotion(
  samples: readonly MotionSample[],
  group: MotionGroup,
  id: string | number,
  renderAt: number,
): MotionVector | undefined {
  let before: { at: number; point: MotionPoint; index: number } | undefined;
  let after: { at: number; point: MotionPoint } | undefined;

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const point = group === 'projectiles'
      ? sample.projectiles.get(id as number)
      : sample[group].get(id as string);
    if (!point) continue;
    if (sample.at <= renderAt) before = { at: sample.at, point, index };
    else {
      after = { at: sample.at, point };
      break;
    }
  }

  if (before && after) {
    const span = Math.max(1, after.at - before.at);
    const alpha = Math.max(0, Math.min(1, (renderAt - before.at) / span));
    if (Math.hypot(after.point.x - before.point.x, after.point.y - before.point.y) > TELEPORT_DISTANCE) {
      return alpha < 1 ? { ...before.point, vx: 0, vy: 0 } : { ...after.point, vx: 0, vy: 0 };
    }
    const seconds = span / 1000;
    return {
      x: before.point.x + (after.point.x - before.point.x) * alpha,
      y: before.point.y + (after.point.y - before.point.y) * alpha,
      vx: (after.point.x - before.point.x) / seconds,
      vy: (after.point.y - before.point.y) / seconds,
    };
  }

  if (before) {
    const authoritativeVx = group === 'projectiles' ? before.point.vx : undefined;
    const authoritativeVy = group === 'projectiles' ? before.point.vy : undefined;
    const extrapolationLimit = group === 'projectiles'
      ? MAX_PROJECTILE_EXTRAPOLATION_MS
      : MAX_EXTRAPOLATION_MS;
    const extrapolation = Math.max(0, Math.min(extrapolationLimit, renderAt - before.at)) / 1000;
    if (authoritativeVx !== undefined && authoritativeVy !== undefined) {
      return {
        x: before.point.x + authoritativeVx * extrapolation,
        y: before.point.y + authoritativeVy * extrapolation,
        vx: authoritativeVx,
        vy: authoritativeVy,
      };
    }
    let previous: { at: number; point: MotionPoint } | undefined;
    for (let index = before.index - 1; index >= 0; index--) {
      const sample = samples[index];
      const point = group === 'projectiles'
        ? sample.projectiles.get(id as number)
        : sample[group].get(id as string);
      if (point) {
        previous = { at: sample.at, point };
        break;
      }
    }
    if (!previous) return { ...before.point, vx: 0, vy: 0 };
    const span = Math.max(1, before.at - previous.at);
    if (Math.hypot(before.point.x - previous.point.x, before.point.y - previous.point.y) > TELEPORT_DISTANCE) {
      return { ...before.point, vx: 0, vy: 0 };
    }
    const seconds = span / 1000;
    const vx = (before.point.x - previous.point.x) / seconds;
    const vy = (before.point.y - previous.point.y) / seconds;
    return {
      x: before.point.x + vx * extrapolation,
      y: before.point.y + vy * extrapolation,
      vx,
      vy,
    };
  }

  return after ? { ...after.point, vx: 0, vy: 0 } : undefined;
}
