import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Colour ramp for the Alpha Score.
 *
 * Deliberately coarse: five bands, not a gradient. An analyst scanning a table
 * needs to sort visually into "look at this" / "maybe" / "no", and a continuous
 * ramp makes 71 and 74 look meaningfully different when they are not.
 */
export function alphaScoreTone(score: number | null | undefined): string {
  if (score == null) return 'text-ink-faint';
  if (score >= 85) return 'text-alpha';
  if (score >= 70) return 'text-good';
  if (score >= 50) return 'text-ink';
  if (score >= 30) return 'text-ink-muted';
  return 'text-ink-faint';
}

export function accessTone(accessClass: string | null | undefined): string {
  switch (accessClass) {
    case 'A':
      return 'text-good';
    case 'B':
      return 'text-warn';
    case 'C':
      return 'text-bad';
    case 'D':
      return 'text-bad font-semibold';
    default:
      return 'text-ink-faint';
  }
}

export function buildabilityTone(rating: string | null | undefined): string {
  switch (rating) {
    case 'GREEN':
      return 'text-good';
    case 'YELLOW':
      return 'text-warn';
    case 'RED':
      return 'text-bad';
    default:
      return 'text-ink-faint';
  }
}

/** Title risk: lower is better, so the ramp is inverted. */
export function titleRiskTone(score: number | null | undefined): string {
  if (score == null) return 'text-ink-faint';
  if (score <= 20) return 'text-good';
  if (score <= 40) return 'text-ink';
  if (score <= 60) return 'text-warn';
  return 'text-bad';
}

export function basisRatioTone(ratio: number | null | undefined): string {
  if (ratio == null) return 'text-ink-faint';
  if (ratio <= 0.1) return 'text-alpha';
  if (ratio <= 0.2) return 'text-good';
  if (ratio <= 0.3) return 'text-ink';
  return 'text-bad';
}

export function confidenceTone(level: string | null | undefined): string {
  switch (level) {
    case 'VERIFIED':
      return 'text-good';
    case 'HIGH':
      return 'text-good';
    case 'MEDIUM':
      return 'text-warn';
    case 'LOW':
      return 'text-bad';
    default:
      return 'text-ink-faint';
  }
}

export function tierTone(tier: string | null | undefined): string {
  switch (tier) {
    case 'EXCEPTIONAL':
      return 'text-alpha';
    case 'STRONG':
      return 'text-good';
    case 'POTENTIAL':
      return 'text-warn';
    case 'WEAK':
      return 'text-bad';
    default:
      return 'text-ink-faint';
  }
}
