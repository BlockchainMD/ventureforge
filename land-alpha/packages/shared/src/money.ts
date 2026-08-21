/**
 * Money handling.
 *
 * All monetary values inside the domain are **integer US cents** (`UsdCents`).
 * The database stores `Decimal(14,2)` dollars for legibility in SQL and BI
 * tools; `packages/db` converts at the boundary and nowhere else.
 *
 * Nothing in the domain performs floating-point arithmetic on dollars.
 */

export type UsdCents = number;

export function dollarsToCents(dollars: number): UsdCents {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: UsdCents): number {
  return cents / 100;
}

export function addCents(...values: (UsdCents | null | undefined)[]): UsdCents {
  let total = 0;
  for (const value of values) {
    if (value == null) continue;
    total += value;
  }
  return Math.round(total);
}

/** Apply a rate (e.g. 0.06) to a cents amount, rounding to the nearest cent. */
export function applyRate(cents: UsdCents, rate: number): UsdCents {
  return Math.round(cents * rate);
}

/**
 * Ratio of two cents amounts as a fraction. Returns null when the denominator
 * is zero or missing — an undefined ratio must never silently become 0 or
 * Infinity, both of which would corrupt ranking.
 */
export function ratio(numerator: UsdCents | null, denominator: UsdCents | null): number | null {
  if (numerator == null || denominator == null) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function clampCents(value: UsdCents, min: UsdCents, max: UsdCents): UsdCents {
  return Math.min(Math.max(value, min), max);
}

export const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const USD_PRECISE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: UsdCents | null | undefined, precise = false): string {
  if (cents == null) return '—';
  return (precise ? USD_PRECISE : USD).format(centsToDollars(cents));
}

/** Compact form for dense tables: $3.1K, $26K, $1.2M. */
export function formatCentsCompact(cents: UsdCents | null | undefined): string {
  if (cents == null) return '—';
  const dollars = centsToDollars(cents);
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `$${Math.round(dollars / 1000)}K`;
  if (abs >= 1000) return `$${(dollars / 1000).toFixed(1)}K`;
  return `$${Math.round(dollars)}`;
}
