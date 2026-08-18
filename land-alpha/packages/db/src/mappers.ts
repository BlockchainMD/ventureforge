import { Prisma } from '@prisma/client';
import { dollarsToCents, centsToDollars, type UsdCents } from '@land-alpha/shared';

/**
 * The single conversion boundary between the database representation of money
 * (Decimal dollars) and the domain representation (integer cents).
 *
 * Nothing else in the codebase is allowed to call `.toNumber()` on a Prisma
 * Decimal. Keeping it here means a rounding-policy change is a one-file change.
 */

export type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export function toCents(value: DecimalLike): UsdCents | null {
  if (value == null) return null;
  if (typeof value === 'number') return dollarsToCents(value);
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? dollarsToCents(parsed) : null;
  }
  // Prisma.Decimal keeps full precision; go through its string form so we never
  // pass through a lossy float before rounding.
  return dollarsToCents(Number.parseFloat(value.toFixed(2)));
}

export function requireCents(value: DecimalLike, field: string): UsdCents {
  const cents = toCents(value);
  if (cents == null) throw new Error(`Expected a monetary value for ${field}`);
  return cents;
}

export function toDecimal(cents: UsdCents | null | undefined): Prisma.Decimal | null {
  if (cents == null) return null;
  return new Prisma.Decimal(centsToDollars(cents).toFixed(2));
}

/** Convert a partial patch object's cents fields to Decimal in one pass. */
export function centsFieldsToDecimal<T extends Record<string, unknown>>(
  patch: T,
  fields: readonly (keyof T)[],
): T {
  const out: Record<string, unknown> = { ...patch };
  for (const field of fields) {
    const value = out[field as string];
    if (value === undefined) continue;
    out[field as string] = toDecimal(value as UsdCents | null);
  }
  return out as T;
}

export function toNumberOrNull(value: number | null | undefined): number | null {
  return value == null || Number.isNaN(value) ? null : value;
}

/** Prisma returns `null` for absent dates; domain code prefers `null` too. */
export function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
