import type { WorldEventType } from '@holdout/shared';

export const RANDOM_EVENT_INITIAL_MIN_MS = 60_000;
export const RANDOM_EVENT_INITIAL_MAX_MS = 120_000;
export const RANDOM_EVENT_MIN_MS = 5 * 60_000;
export const RANDOM_EVENT_MAX_MS = 9 * 60_000;

/** Deterministic scheduling helper so event cadence can be regression tested. */
export function randomEventDelay(rnd: () => number, initial = false): number {
  const min = initial ? RANDOM_EVENT_INITIAL_MIN_MS : RANDOM_EVENT_MIN_MS;
  const max = initial ? RANDOM_EVENT_INITIAL_MAX_MS : RANDOM_EVENT_MAX_MS;
  return min + Math.floor(Math.max(0, Math.min(0.999999999, rnd())) * (max - min + 1));
}

export function randomEventType(rnd: () => number): WorldEventType {
  return rnd() < 0.55 ? 'supply_drop' : 'boss';
}
