import { describe, expect, it } from 'vitest';

/**
 * Field naming on the National Wetlands Inventory.
 *
 * The service moved from fws.gov to a USGS host and now returns its fields
 * qualified by the source table. Asking for the old unqualified names makes
 * the whole query fail with a bare 400 — which the adapter reads as "no
 * wetlands found", the most dangerous possible failure mode here. A parcel
 * that is entirely swamp would come back clean and be bought.
 */

/** Mirrors the accessor in the adapter. */
function wetlandTypeOf(attributes: Record<string, unknown>): string | undefined {
  const value =
    attributes['Wetlands.WETLAND_TYPE'] ??
    attributes.WETLAND_TYPE ??
    attributes['Wetlands.ATTRIBUTE'] ??
    attributes.ATTRIBUTE;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

describe('wetland attribute reading', () => {
  it('reads the qualified names the current service returns', () => {
    expect(wetlandTypeOf({ 'Wetlands.WETLAND_TYPE': 'Freshwater Forested/Shrub Wetland' })).toBe(
      'Freshwater Forested/Shrub Wetland',
    );
  });

  it('still reads the bare names an older deployment returns', () => {
    expect(wetlandTypeOf({ WETLAND_TYPE: 'Estuarine and Marine Wetland' })).toBe(
      'Estuarine and Marine Wetland',
    );
  });

  it('falls back to the attribute code when no type is given', () => {
    expect(wetlandTypeOf({ 'Wetlands.ATTRIBUTE': 'PFO1C' })).toBe('PFO1C');
    expect(wetlandTypeOf({ ATTRIBUTE: 'PEM1A' })).toBe('PEM1A');
  });

  it('treats blank and missing alike, rather than as a wetland named ""', () => {
    expect(wetlandTypeOf({})).toBeUndefined();
    expect(wetlandTypeOf({ WETLAND_TYPE: '   ' })).toBeUndefined();
    expect(wetlandTypeOf({ WETLAND_TYPE: 42 })).toBeUndefined();
  });
});
