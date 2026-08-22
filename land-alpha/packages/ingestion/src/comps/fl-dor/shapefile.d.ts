/**
 * Minimal typings for `shapefile`, which ships none.
 *
 * Only the streaming reader is declared, and only the shape of it this project
 * relies on — a wider guess would be a worse lie than a narrow one.
 */
declare module 'shapefile' {
  export interface ShapefileFeature {
    type: 'Feature';
    properties: Record<string, unknown> | null;
    geometry: { type: string; coordinates: unknown } | null;
  }

  export interface ShapefileSource {
    read(): Promise<{ done: boolean; value: ShapefileFeature }>;
    bbox: number[] | undefined;
  }

  export function open(
    shp: Uint8Array | string,
    dbf?: Uint8Array | string | null,
    options?: { encoding?: string },
  ): Promise<ShapefileSource>;

  export function openDbf(
    dbf: Uint8Array | string,
    options?: { encoding?: string },
  ): Promise<{ read(): Promise<{ done: boolean; value: Record<string, unknown> }> }>;
}
