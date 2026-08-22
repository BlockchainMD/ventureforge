import type { ArcGisClient } from '../fetch/arcgis';
import { arcgisLiteral } from '../fetch/arcgis';

/**
 * Resolve many parcel IDs against a county parcel layer in as few requests as
 * possible.
 *
 * A tax-sale list publishes an identifier and little else. The county's own
 * parcel layer publishes the boundary, the acreage, the assessed values and the
 * zoning for the same parcel, for free, and without it a record from a sparse
 * source scores UNKNOWN on most of what the Alpha Score is made of.
 *
 * Only unambiguous single matches are kept: if one candidate ID resolves to
 * more than one parcel, none of them is used.
 */
export async function batchLookupParcels(
  client: ArcGisClient,
  parcelLayerUrl: string,
  candidates: string[],
  options: { parcelIdField?: string; signal?: AbortSignal } = {},
): Promise<Map<string, Record<string, unknown>>> {
  const parcelIdField = options.parcelIdField ?? 'PARCEL';
  const resolved = new Map<string, Record<string, unknown>>();
  const ambiguous = new Set<string>();

  // Chunk by URL length, not by record count. ArcGIS queries are sent as GET,
  // and servers reject an over-long query string with a bare 404 that looks
  // exactly like a missing layer — so the budget is enforced here rather than
  // discovered in production.
  const WHERE_BUDGET_CHARS = 1400;

  for (const chunk of chunkByLength(candidates, WHERE_BUDGET_CHARS)) {
    if (options.signal?.aborted) break;
    const literals = chunk.map((value) => arcgisLiteral(value)).join(', ');
    try {
      const features = await client.queryAll(parcelLayerUrl, {
        where: `${parcelIdField} IN (${literals})`,
        // The polygon is the point of this lookup, not a bonus. Without a
        // boundary there is no frontage to measure, no shape to judge and no
        // buildable area to speak of.
        returnGeometry: true,
        maxFeatures: chunk.length * 3,
      });
      for (const feature of features) {
        const raw = feature.attributes[parcelIdField];
        const key = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw) : null;
        if (!key) continue;
        if (resolved.has(key)) {
          ambiguous.add(key);
          continue;
        }
        resolved.set(key, { ...feature.attributes, __geometry: feature.geometry });
      }
    } catch {
      // Enrichment is best-effort: a failure here must never fail the run.
      break;
    }
  }

  for (const key of ambiguous) resolved.delete(key);
  return resolved;
}

export function chunkByLength(values: readonly string[], budget: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const value of values) {
    const cost = value.length + 4; // quotes, comma, space
    if (current.length > 0 && length + cost > budget) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(value);
    length += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
