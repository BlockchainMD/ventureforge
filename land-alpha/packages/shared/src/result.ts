/**
 * A tiny Result type. Adapters return partial successes constantly — 400 rows
 * parsed, 3 rejected — and throwing loses the 400. Result makes the partial
 * outcome the normal case rather than an afterthought.
 */

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export interface PartialOutcome<T> {
  readonly items: readonly T[];
  readonly rejected: readonly RejectedItem[];
}

export interface RejectedItem {
  readonly index: number;
  readonly reason: string;
  readonly raw?: unknown;
}

export function partition<T>(results: readonly Result<T, string>[]): {
  items: T[];
  rejected: RejectedItem[];
} {
  const items: T[] = [];
  const rejected: RejectedItem[] = [];
  results.forEach((result, index) => {
    if (result.ok) items.push(result.value);
    else rejected.push({ index, reason: result.error });
  });
  return { items, rejected };
}
