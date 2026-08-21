import Link from 'next/link';
import { spatial } from '@land-alpha/db';

type MapParcelRow = Awaited<ReturnType<typeof spatial.queryParcelsInBounds>>[number];
import {
  formatAcres,
  formatCents,
  formatNumber,
  type BBox,
  type ParcelGeometry,
} from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { ParcelMap } from '@/components/ui/parcel-map';
import { Value } from '@/components/ui/value';
import { alphaScoreTone } from '@/lib/utils';

export const metadata = { title: 'Map — Land Alpha' };
export const dynamic = 'force-dynamic';

/**
 * Geographic view.
 *
 * Inventory is clustered by county rather than drawn as one national map,
 * because the parcels are thousands of miles apart and a single view of the
 * whole country shows nothing useful. Each county panel is a real spatial
 * query against the parcel geometry.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ minAlpha?: string }>;
}) {
  const { minAlpha } = await searchParams;
  const minAlphaScore = minAlpha ? Number(minAlpha) : undefined;

  // Continental US plus a margin, then grouped by county below.
  const bbox: BBox = [-179.5, 17.5, -64.5, 72.0];
  const rows = await spatial.queryParcelsInBounds(bbox, {
    limit: 1500,
    minAlphaScore: Number.isFinite(minAlphaScore) ? minAlphaScore : undefined,
  });

  const byCounty = new Map<string, MapParcelRow[]>();
  for (const row of rows) {
    const key = `${row.state} · ${row.county}`;
    const list = byCounty.get(key) ?? [];
    list.push(row);
    byCounty.set(key, list);
  }

  const groups = [...byCounty.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <>
      <PageHeader
        title="Map"
        subtitle={`${formatNumber(rows.length)} parcels with mapped geometry, grouped by county`}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {[0, 50, 70, 85].map((threshold) => (
              <Link
                key={threshold}
                href={threshold === 0 ? '/map' : `/map?minAlpha=${threshold}`}
                className={`rounded-sm px-2 py-1 text-[10px] uppercase tracking-wider ${
                  (minAlphaScore ?? 0) === threshold
                    ? 'bg-raised text-alpha'
                    : 'text-ink-faint hover:text-ink'
                }`}
              >
                {threshold === 0 ? 'All' : `Alpha ≥ ${threshold}`}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2 sm:p-4">
        {groups.length === 0 ? (
          <Panel className="lg:col-span-2">
            <PanelBody>
              <p className="py-12 text-center text-xs text-ink-faint">
                No parcels with mapped geometry. Run an ingestion from a source that publishes
                parcel polygons.
              </p>
            </PanelBody>
          </Panel>
        ) : (
          groups.map(([county, parcels]) => {
            const geometries = parcels
              .map((parcel) =>
                parcel.geojson ? (JSON.parse(parcel.geojson) as ParcelGeometry) : null,
              )
              .filter((geometry): geometry is ParcelGeometry => geometry != null);

            const merged: ParcelGeometry | null =
              geometries.length === 0
                ? null
                : {
                    type: 'MultiPolygon',
                    coordinates: geometries.flatMap((geometry) =>
                      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates,
                    ),
                  };

            const best = [...parcels]
              .sort((a, b) => (b.alphaScore ?? 0) - (a.alphaScore ?? 0))
              .slice(0, 6);

            return (
              <Panel key={county}>
                <PanelHeader title={county} subtitle={`${formatNumber(parcels.length)} parcels`} />
                <ParcelMap geometry={merged} centroid={null} height={260} className="border-x-0" />
                <PanelBody className="space-y-1">
                  {best.map((parcel) => (
                    <div key={parcel.id} className="flex items-center justify-between gap-2">
                      <Link
                        href={`/opportunities/${parcel.id}`}
                        className="num min-w-0 truncate text-[11px] text-ink-muted hover:text-alpha"
                      >
                        {parcel.apn ?? parcel.id.slice(0, 8)}
                      </Link>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="num text-[11px] text-ink-faint">
                          <Value>
                            {parcel.acreage == null ? null : formatAcres(parcel.acreage)}
                          </Value>
                        </span>
                        <span className="num text-[11px] text-ink-muted">
                          <Value>
                            {parcel.askingPrice == null
                              ? null
                              : formatCents(Math.round(Number(parcel.askingPrice) * 100))}
                          </Value>
                        </span>
                        <span
                          className={`num w-6 text-right text-xs font-semibold ${alphaScoreTone(parcel.alphaScore)}`}
                        >
                          <Value>
                            {parcel.alphaScore == null ? null : Math.round(parcel.alphaScore)}
                          </Value>
                        </span>
                      </div>
                    </div>
                  ))}
                </PanelBody>
              </Panel>
            );
          })
        )}
      </div>
    </>
  );
}
