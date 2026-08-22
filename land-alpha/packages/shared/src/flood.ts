/**
 * FEMA flood zone codes.
 *
 * Shared between the connector that reads a flood layer and the engine that
 * interprets it, because the two disagreeing would be invisible: the connector
 * would measure overlap against polygons the engine does not consider hazards,
 * and the resulting fraction would look like a fact.
 */

/** Zones inside the 1%-annual-chance floodplain. V zones are coastal high hazard. */
const SFHA_ZONE_PREFIXES = ['A', 'V'];

/**
 * Explicitly outside it. Zone X in particular is "area of minimal flood
 * hazard" and blankets everything the floodplain does not, so counting it as
 * hazard overlap puts every dry parcel at 100%.
 */
const NON_SFHA_ZONES = new Set(['X', 'B', 'C', 'D', 'AREA NOT INCLUDED', 'OPEN WATER']);

export function isSpecialFloodHazardZone(zone: string): boolean {
  const normalized = zone.trim().toUpperCase();
  if (NON_SFHA_ZONES.has(normalized)) return false;
  if (normalized.startsWith('X')) return false;
  // Names a county table gives when it measured the area itself rather than
  // publishing a FEMA code. Both sit inside the 1%-annual-chance floodplain.
  if (/FLOODWAY|100-YEAR FLOODPLAIN/.test(normalized)) return true;
  return SFHA_ZONE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
