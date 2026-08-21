/** Display formatting helpers shared by the web app and generated documents. */

export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatPercent(fraction: number | null | undefined, fractionDigits = 1): string {
  if (fraction == null || Number.isNaN(fraction)) return '—';
  return `${(fraction * 100).toFixed(fractionDigits)}%`;
}

export function formatAcres(acres: number | null | undefined): string {
  if (acres == null || Number.isNaN(acres)) return '—';
  if (acres >= 100) return `${formatNumber(acres, 1)} ac`;
  return `${formatNumber(acres, 2)} ac`;
}

export function formatFeet(feet: number | null | undefined): string {
  if (feet == null || Number.isNaN(feet)) return '—';
  return `${formatNumber(Math.round(feet))} ft`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "in 4 days", "3 hours ago". Used for auction deadlines and source freshness. */
export function formatRelative(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const deltaMs = date.getTime() - now.getTime();
  const abs = Math.abs(deltaMs);
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600_000],
    ['month', 30 * 24 * 3600_000],
    ['day', 24 * 3600_000],
    ['hour', 3600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return formatter.format(Math.round(deltaMs / ms), unit);
  }
  return 'just now';
}

export function daysUntil(
  value: Date | string | null | undefined,
  now = new Date(),
): number | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / (24 * 3600_000));
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** ENUM_LIKE_THIS -> "Enum like this" for UI labels. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
