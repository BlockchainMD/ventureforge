import { ParseError } from '@land-alpha/shared';
import type { ParcelGeometry, Position } from '@land-alpha/shared';
import { esriPolygonToGeoJson, esriPointToPosition, type EsriPolygon } from '@land-alpha/gis';
import type { IngestHttpClient } from './http.js';

/**
 * ArcGIS REST client.
 *
 * ArcGIS is the single most valuable ingestion surface for this product: when a
 * county publishes one, it is authoritative, structured, geometry-bearing and
 * explicitly intended for programmatic access. It is second only to a formal
 * API in the preference order, and in practice it is what most counties have.
 *
 * Three things this client gets right that a naive `fetch` loop does not:
 *
 *  1. **Pagination via `resultOffset`.** Services cap responses at
 *     `maxRecordCount` (commonly 1,000-2,000) and silently truncate. Missing
 *     that means quietly ingesting the first 2,000 of 14,000 parcels.
 *  2. **`outSR=4326`.** Services publish in whatever projection the county
 *     uses (St. Louis County MN is UTM 15N / EPSG:26915). Asking the server to
 *     reproject is both cheaper and more accurate than doing it here.
 *  3. **`exceededTransferLimit` honouring.** The flag is the service telling us
 *     it truncated; we page until it is absent rather than guessing from counts.
 */

export interface ArcGisQueryOptions {
  readonly where: string;
  readonly outFields?: string[];
  readonly returnGeometry?: boolean;
  /** Page size. Clamped by the service's own maxRecordCount. */
  readonly pageSize?: number;
  /** Safety cap so a misconfigured `where` cannot pull a whole state. */
  readonly maxFeatures?: number;
  readonly orderByFields?: string;
}

export interface ArcGisFeature {
  readonly attributes: Record<string, unknown>;
  readonly geometry: ParcelGeometry | null;
  readonly point: Position | null;
}

export interface ArcGisLayerInfo {
  readonly name: string;
  readonly geometryType: string;
  readonly maxRecordCount: number;
  readonly fields: { name: string; type: string; alias?: string }[];
  readonly copyrightText: string | null;
  readonly description: string | null;
}

interface RawQueryResponse {
  features?: {
    attributes?: Record<string, unknown>;
    geometry?: Record<string, unknown>;
  }[];
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
  geometryType?: string;
  error?: { code: number; message: string; details?: string[] };
}

export class ArcGisClient {
  constructor(private readonly http: IngestHttpClient) {}

  async layerInfo(layerUrl: string): Promise<ArcGisLayerInfo> {
    const raw = await this.http.getJson<Record<string, unknown>>(`${layerUrl}?f=json`);
    if (raw.error) {
      throw new ParseError(`ArcGIS layer metadata error: ${JSON.stringify(raw.error)}`, { layerUrl });
    }
    return {
      name: String(raw.name ?? 'unknown'),
      geometryType: String(raw.geometryType ?? 'unknown'),
      maxRecordCount: Number(raw.maxRecordCount ?? 1000),
      fields: Array.isArray(raw.fields)
        ? (raw.fields as { name: string; type: string; alias?: string }[])
        : [],
      copyrightText: raw.copyrightText ? String(raw.copyrightText) : null,
      description: raw.description ? String(raw.description) : null,
    };
  }

  async count(layerUrl: string, where: string): Promise<number> {
    const url = `${layerUrl}/query?${new URLSearchParams({
      where,
      returnCountOnly: 'true',
      f: 'json',
    }).toString()}`;
    const raw = await this.http.getJson<{ count?: number; error?: unknown }>(url);
    if (raw.error) throw new ParseError(`ArcGIS count error: ${JSON.stringify(raw.error)}`, { layerUrl });
    return Number(raw.count ?? 0);
  }

  /**
   * Page through a query, yielding features as they arrive so a 14,000-parcel
   * county never has to be held in memory at once.
   */
  async *query(layerUrl: string, options: ArcGisQueryOptions): AsyncGenerator<ArcGisFeature> {
    const info = await this.layerInfo(layerUrl);
    const pageSize = Math.min(options.pageSize ?? 1000, info.maxRecordCount || 1000);
    const maxFeatures = options.maxFeatures ?? 50_000;
    const returnGeometry = options.returnGeometry ?? true;

    let offset = 0;
    let yielded = 0;

    for (;;) {
      const params = new URLSearchParams({
        where: options.where,
        outFields: (options.outFields ?? ['*']).join(','),
        returnGeometry: String(returnGeometry),
        outSR: '4326',
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        f: 'json',
      });
      // A stable sort is required for offset paging to be correct; without it
      // the service may reorder between pages and silently drop or duplicate rows.
      params.set('orderByFields', options.orderByFields ?? 'OBJECTID');

      const raw = await this.http.getJson<RawQueryResponse>(`${layerUrl}/query?${params.toString()}`);
      if (raw.error) {
        throw new ParseError(`ArcGIS query error: ${raw.error.message}`, {
          layerUrl,
          details: raw.error.details,
          where: options.where,
        });
      }

      const features = raw.features ?? [];
      if (features.length === 0) return;

      for (const feature of features) {
        if (yielded >= maxFeatures) return;
        yield toFeature(feature, raw.geometryType);
        yielded += 1;
      }

      const exceeded = raw.exceededTransferLimit ?? raw.properties?.exceededTransferLimit ?? false;
      // Some services omit the flag; falling back to "a full page means more"
      // keeps paging correct on those.
      if (!exceeded && features.length < pageSize) return;

      offset += features.length;
      if (offset >= maxFeatures) return;
    }
  }

  async queryAll(layerUrl: string, options: ArcGisQueryOptions): Promise<ArcGisFeature[]> {
    const out: ArcGisFeature[] = [];
    for await (const feature of this.query(layerUrl, options)) out.push(feature);
    return out;
  }
}

function toFeature(
  feature: { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> },
  geometryType: string | undefined,
): ArcGisFeature {
  const attributes = feature.attributes ?? {};
  const geometry = feature.geometry;

  if (!geometry) return { attributes, geometry: null, point: null };

  if (Array.isArray(geometry.rings)) {
    const polygon = esriPolygonToGeoJson(geometry as unknown as EsriPolygon);
    return { attributes, geometry: polygon, point: null };
  }

  if (typeof geometry.x === 'number' && typeof geometry.y === 'number') {
    const point = esriPointToPosition({
      x: geometry.x,
      y: geometry.y,
      spatialReference: geometry.spatialReference as { wkid?: number } | undefined,
    });
    return { attributes, geometry: null, point };
  }

  void geometryType;
  return { attributes, geometry: null, point: null };
}

/**
 * Build a SQL-92 `where` clause fragment safely.
 *
 * ArcGIS `where` is passed through to the underlying database, so a value
 * containing a quote is an injection vector against the county's server. We
 * escape rather than interpolate blindly, and reject anything with a statement
 * terminator.
 */
export function arcgisLiteral(value: string): string {
  if (value.includes(';') || value.includes('--')) {
    throw new ParseError('Refusing to build an ArcGIS where clause from a suspicious literal', {
      value,
    });
  }
  return `'${value.replace(/'/g, "''")}'`;
}
