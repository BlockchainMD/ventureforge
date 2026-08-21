/** Unit conversions. Land Alpha stores metric internally and displays imperial. */

export const SQ_METERS_PER_ACRE = 4046.8564224;
export const SQ_FEET_PER_ACRE = 43_560;
export const METERS_PER_FOOT = 0.3048;
export const FEET_PER_METER = 1 / METERS_PER_FOOT;
export const METERS_PER_MILE = 1609.344;

export function sqMetersToAcres(sqMeters: number): number {
  return sqMeters / SQ_METERS_PER_ACRE;
}

export function acresToSqMeters(acres: number): number {
  return acres * SQ_METERS_PER_ACRE;
}

export function acresToSqFeet(acres: number): number {
  return acres * SQ_FEET_PER_ACRE;
}

export function sqFeetToAcres(sqFeet: number): number {
  return sqFeet / SQ_FEET_PER_ACRE;
}

export function metersToFeet(meters: number): number {
  return meters * FEET_PER_METER;
}

export function feetToMeters(feet: number): number {
  return feet * METERS_PER_FOOT;
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/** Round to a sensible number of significant places for an acreage figure. */
export function roundAcres(acres: number): number {
  if (acres >= 100) return Math.round(acres * 10) / 10;
  return Math.round(acres * 100) / 100;
}
