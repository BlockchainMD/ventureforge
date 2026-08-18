'use client';

import { useMemo } from 'react';
import type { ParcelGeometry, Position } from '@land-alpha/shared';

/**
 * Parcel map.
 *
 * Renders the parcel polygon, its overlays and its surroundings as inline SVG
 * in a local projection, with no tile dependency at all. That is a deliberate
 * choice: the map has to work in an air-gapped demo, in CI, and on a laptop in
 * a county office with no signal, and a basemap that fails to load is worse
 * than no basemap.
 *
 * When `NEXT_PUBLIC_MAP_STYLE_URL` is configured, a satellite/vector view is
 * offered as an additional layer — but the geometry itself is always readable
 * without it.
 */
export function ParcelMap({
  geometry,
  centroid,
  overlays = [],
  roads = [],
  height = 320,
  className,
}: {
  geometry: ParcelGeometry | null;
  centroid: Position | null;
  overlays?: { label: string; kind: 'flood' | 'wetland'; geometry: ParcelGeometry }[];
  roads?: { name: string | null; coordinates: Position[] }[];
  height?: number;
  className?: string;
}) {
  const scene = useMemo(
    () => buildScene(geometry, centroid, overlays, roads),
    [geometry, centroid, overlays, roads],
  );

  if (!scene) {
    return (
      <div
        className={`flex items-center justify-center border border-line bg-surface text-xs text-ink-faint ${className ?? ''}`}
        style={{ height }}
      >
        No mapped geometry for this parcel.
      </div>
    );
  }

  return (
    <div className={`relative border border-line bg-surface ${className ?? ''}`} style={{ height }}>
      <svg viewBox={`0 0 ${scene.width} ${scene.height}`} className="h-full w-full">
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1a2130" strokeWidth="0.5" />
          </pattern>
          <pattern id="wetland-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#34d399" strokeWidth="1.4" opacity="0.55" />
          </pattern>
          <pattern id="flood-hatch" width="6" height="6" patternTransform="rotate(-45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#60a5fa" strokeWidth="1.4" opacity="0.55" />
          </pattern>
        </defs>

        <rect width={scene.width} height={scene.height} fill="url(#grid)" />

        {scene.roads.map((road, index) => (
          <g key={`road-${index}`}>
            <polyline points={road.points} fill="none" stroke="#2f3a4c" strokeWidth={6} strokeLinecap="round" />
            <polyline points={road.points} fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" />
          </g>
        ))}

        {scene.overlays.map((overlay, index) => (
          <path
            key={`overlay-${index}`}
            d={overlay.path}
            fill={overlay.kind === 'flood' ? 'url(#flood-hatch)' : 'url(#wetland-hatch)'}
            stroke={overlay.kind === 'flood' ? '#60a5fa' : '#34d399'}
            strokeWidth={1}
            opacity={0.8}
          />
        ))}

        {scene.parcel ? (
          <path d={scene.parcel} fill="#f0b429" fillOpacity={0.14} stroke="#f0b429" strokeWidth={2} />
        ) : null}

        {scene.centroid ? (
          <circle cx={scene.centroid[0]} cy={scene.centroid[1]} r={4} fill="#f0b429" />
        ) : null}
      </svg>

      <div className="pointer-events-none absolute bottom-1.5 left-2 flex items-center gap-3 text-[10px] text-ink-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 border border-alpha bg-alpha/20" /> parcel
        </span>
        {overlays.some((o) => o.kind === 'flood') ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 border border-info bg-info/20" /> flood
          </span>
        ) : null}
        {overlays.some((o) => o.kind === 'wetland') ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 border border-good bg-good/20" /> wetland
          </span>
        ) : null}
      </div>
      <p className="pointer-events-none absolute bottom-1.5 right-2 num text-[10px] text-ink-faint">
        {scene.scaleLabel}
      </p>
    </div>
  );
}

interface Scene {
  width: number;
  height: number;
  parcel: string | null;
  centroid: [number, number] | null;
  overlays: { path: string; kind: 'flood' | 'wetland' }[];
  roads: { points: string }[];
  scaleLabel: string;
}

function buildScene(
  geometry: ParcelGeometry | null,
  centroid: Position | null,
  overlays: { label: string; kind: 'flood' | 'wetland'; geometry: ParcelGeometry }[],
  roads: { name: string | null; coordinates: Position[] }[],
): Scene | null {
  const allPositions: Position[] = [];
  if (geometry) allPositions.push(...positionsOf(geometry));
  for (const overlay of overlays) allPositions.push(...positionsOf(overlay.geometry));
  for (const road of roads) allPositions.push(...road.coordinates);
  if (centroid) allPositions.push(centroid);
  if (allPositions.length === 0) return null;

  const lons = allPositions.map((p) => p[0]);
  const lats = allPositions.map((p) => p[1]);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  const midLat = (south + north) / 2;
  // Equirectangular with a latitude correction. At parcel scale this is
  // visually indistinguishable from a proper projection and needs no library.
  const lonScale = Math.cos((midLat * Math.PI) / 180);

  const spanX = Math.max((east - west) * lonScale, 1e-6);
  const spanY = Math.max(north - south, 1e-6);
  const padding = 0.12;

  const width = 800;
  const height = Math.round(width * Math.min(2, Math.max(0.45, spanY / spanX)));

  const project = ([lon, lat]: Position): [number, number] => {
    const x = ((lon - west) * lonScale) / spanX;
    const y = (north - lat) / spanY;
    return [
      padding * width + x * width * (1 - 2 * padding),
      padding * height + y * height * (1 - 2 * padding),
    ];
  };

  const toPath = (target: ParcelGeometry): string => {
    const polygons = target.type === 'Polygon' ? [target.coordinates] : target.coordinates;
    return polygons
      .map((rings) =>
        rings
          .map((ring) => {
            const points = (ring as Position[]).map(project);
            if (points.length === 0) return '';
            return `M ${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`;
          })
          .join(' '),
      )
      .join(' ');
  };

  const spanMeters = spanX * 111_320;
  const scaleLabel =
    spanMeters > 1500
      ? `${(spanMeters / 1000).toFixed(1)} km across`
      : `${Math.round(spanMeters)} m across`;

  return {
    width,
    height,
    parcel: geometry ? toPath(geometry) : null,
    centroid: centroid ? project(centroid) : null,
    overlays: overlays.map((overlay) => ({ path: toPath(overlay.geometry), kind: overlay.kind })),
    roads: roads.map((road) => ({
      points: road.coordinates
        .map(project)
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(' '),
    })),
    scaleLabel,
  };
}

function positionsOf(geometry: ParcelGeometry): Position[] {
  return geometry.type === 'Polygon'
    ? (geometry.coordinates.flat() as Position[])
    : (geometry.coordinates.flat(2) as Position[]);
}
