import { prisma, type EnvironmentalLayer } from '@land-alpha/db';

/**
 * Analyst-recorded environmental screening.
 *
 * Three of the five public environmental layers are published behind robots
 * directives or bot protection that Land Alpha does not work around, so the
 * only screening those layers ever get is a person opening the map viewer. This
 * module is the seam that puts what they saw on the same footing as an API
 * response: the enrichment service reads these records as observations, and
 * everything downstream — confidence, buildability, memo text — reacts exactly
 * as it would to a live query.
 *
 * The one thing that must never blur is provenance. A manual screen names the
 * analyst in its source string, so a memo reader can tell an assertion made by
 * a federal dataset from one made by a colleague at 4pm on a Friday.
 */

export interface ManualScreenInput {
  readonly parcelId: string;
  readonly layer: EnvironmentalLayer;
  /** Zone codes, NWI classifications, or site names — whatever the viewer showed. */
  readonly findings: readonly string[];
  readonly overlapFraction?: number | null;
  readonly nearestSiteMeters?: number | null;
  /** The analyst confirmed the layer maps nothing here. */
  readonly clear: boolean;
  readonly sourceUrl?: string | null;
  readonly notes?: string | null;
  readonly screenedById: string | null;
  readonly screenedByLabel: string;
}

/** An observation as the environmental engine consumes it. */
export interface ManualScreenObservation {
  readonly findings: readonly string[];
  readonly overlapFraction: number | null;
  readonly nearestSiteMeters: number | null;
  readonly source: string;
}

/**
 * Records a screen, superseding any earlier one for the same layer.
 *
 * The earlier record is marked superseded rather than deleted. A screening that
 * later proved wrong is evidence about how the screening was done, and deleting
 * it removes the only trace that anyone ever looked.
 */
export async function recordManualScreen(input: ManualScreenInput): Promise<{ id: string }> {
  if (!input.clear && input.findings.length === 0 && input.nearestSiteMeters == null) {
    throw new Error(
      'A screen must record either a finding or an explicit confirmation that the layer is clear.',
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.manualEnvironmentalScreen.updateMany({
      where: { parcelId: input.parcelId, layer: input.layer, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    const created = await tx.manualEnvironmentalScreen.create({
      data: {
        parcelId: input.parcelId,
        layer: input.layer,
        findings: [...input.findings],
        overlapFraction: input.overlapFraction ?? null,
        nearestSiteMeters: input.nearestSiteMeters ?? null,
        clear: input.clear,
        sourceUrl: input.sourceUrl ?? null,
        notes: input.notes ?? null,
        screenedById: input.screenedById,
        screenedByLabel: input.screenedByLabel,
      },
      select: { id: true },
    });
    return created;
  });
}

/** The current screen per layer for a parcel, keyed by layer. */
export async function loadManualScreens(
  parcelId: string,
): Promise<Partial<Record<EnvironmentalLayer, ManualScreenObservation>>> {
  const rows = await prisma.manualEnvironmentalScreen.findMany({
    where: { parcelId, supersededAt: null },
    orderBy: { screenedAt: 'desc' },
  });

  const byLayer: Partial<Record<EnvironmentalLayer, ManualScreenObservation>> = {};
  for (const row of rows) {
    // Newest first, so the first row for a layer wins. There should only ever
    // be one un-superseded row per layer; this is belt and braces.
    if (byLayer[row.layer]) continue;
    byLayer[row.layer] = {
      findings: row.findings,
      overlapFraction: row.overlapFraction,
      nearestSiteMeters: row.nearestSiteMeters,
      source: `Analyst screen by ${row.screenedByLabel}, ${row.screenedAt.toISOString().slice(0, 10)}`,
    };
  }
  return byLayer;
}
