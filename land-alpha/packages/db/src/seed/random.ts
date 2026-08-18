/**
 * Deterministic PRNG.
 *
 * Fixtures must be byte-identical across machines and reruns: a seed that
 * produces different comps each time makes valuation tests untrustworthy and
 * makes "why did this parcel's score change?" unanswerable. `Math.random` is
 * therefore never used in seeding.
 *
 * mulberry32 — small, fast, and good enough for generating plausible data.
 */
export function createRandom(seed: number): {
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
  bool(probability?: number): boolean;
  jitter(value: number, fraction: number): number;
} {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => next() * (max - min) + min,
    pick: <T,>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!,
    bool: (probability = 0.5) => next() < probability,
    jitter: (value, fraction) => value * (1 + (next() * 2 - 1) * fraction),
  };
}
