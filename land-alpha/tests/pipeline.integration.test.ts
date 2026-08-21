import { describe, expect, it, beforeAll } from 'vitest';
import { prisma, getActiveScoringConfig, spatial, toCents } from '@land-alpha/db';
import { FIXTURE_PARCELS } from '@land-alpha/db/seed/fixture-parcels';
import { scoreParcelById, valuateParcel } from '@land-alpha/core';
import { normalizeApn } from '@land-alpha/shared/ids';

/**
 * Pipeline integration tests.
 *
 * These run against a real PostgreSQL + PostGIS database and turn the fixture
 * specifications into assertions: each of the thirteen specification parcels
 * declares what the pipeline must conclude about it, and this file checks that
 * the pipeline actually concludes it.
 *
 * That makes `fixture-parcels.ts` a specification rather than sample data — a
 * change to a rejection rule that breaks an archetype fails here, loudly, with
 * the rule named.
 *
 * Requires: pnpm db:migrate && pnpm db:seed && pnpm pipeline
 * Skipped automatically when no database is reachable, so `pnpm test` stays
 * green on a machine with no Postgres.
 */

let databaseAvailable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const seeded = await prisma.parcelOpportunity.count({ where: { apn: { startsWith: 'FX-' } } });
    databaseAvailable = seeded > 0;
  } catch {
    databaseAvailable = false;
  }
});

const spec = (name: string, fn: () => Promise<void>): void => {
  it(name, async () => {
    if (!databaseAvailable) {
      console.warn('  (skipped — no seeded database available)');
      return;
    }
    await fn();
  });
};

describe('PostGIS', () => {
  spec('is installed and reports its version', async () => {
    const version = await spatial.postgisVersion();
    expect(version).toBeTruthy();
  });

  spec('measures parcel acreage in metres, not square degrees', async () => {
    const parcel = await prisma.parcelOpportunity.findFirst({
      where: { apn: 'FX-010-0001-00010' },
      select: { id: true, acreage: true },
    });
    expect(parcel).not.toBeNull();

    const rows = await prisma.$queryRaw<{ acres: number }[]>`
      SELECT ST_Area("geometry"::geography) / 4046.8564224 AS acres
      FROM "ParcelOpportunity" WHERE "id" = ${parcel!.id}
    `;
    // Agreement between the stored acreage and an independent PostGIS
    // measurement is what proves the geography cast is doing its job.
    expect(Number(rows[0]!.acres)).toBeCloseTo(parcel!.acreage!, 1);
  });

  spec('rejects non-polygonal geometry via the check constraint', async () => {
    const parcel = await prisma.parcelOpportunity.findFirst({ select: { id: true } });
    await expect(
      prisma.$executeRaw`
        UPDATE "ParcelOpportunity"
        SET "geometry" = ST_SetSRID(ST_MakePoint(-92.3, 47.4), 4326)
        WHERE "id" = ${parcel!.id}
      `,
    ).rejects.toThrow();
  });
});

describe('fixture specifications', () => {
  for (const fixture of FIXTURE_PARCELS) {
    spec(`${fixture.apn} — ${fixture.expectation.note}`, async () => {
      const parcel = await prisma.parcelOpportunity.findFirst({
        where: { apn: fixture.apn },
        select: {
          id: true,
          alphaScore: true,
          rejected: true,
          rejectionReasons: true,
          accessClass: true,
          buildability: true,
          basisToQsv: true,
        },
      });
      expect(parcel, `fixture ${fixture.apn} was not seeded`).not.toBeNull();

      expect(parcel!.rejected, `${fixture.apn} rejection state`).toBe(fixture.expectation.rejected);

      if (fixture.expectation.rejectionRule) {
        const rules = (parcel!.rejectionReasons as { rule: string }[]).map((r) => r.rule);
        expect(rules, `${fixture.apn} rejection rules`).toContain(
          fixture.expectation.rejectionRule,
        );
      }
      if (fixture.expectation.accessClass) {
        expect(parcel!.accessClass, `${fixture.apn} access class`).toBe(
          fixture.expectation.accessClass,
        );
      }
      if (fixture.expectation.buildability) {
        expect(parcel!.buildability, `${fixture.apn} buildability`).toBe(
          fixture.expectation.buildability,
        );
      }
      // A rejected parcel must score zero: rejection removes it from the funnel
      // rather than merely penalising it.
      if (fixture.expectation.rejected) {
        expect(parcel!.alphaScore).toBe(0);
      }
    });
  }
});

describe('scoring invariants', () => {
  spec('never produces a score outside 0-100', async () => {
    const extremes = await prisma.parcelOpportunity.aggregate({
      _min: { alphaScore: true },
      _max: { alphaScore: true },
    });
    expect(extremes._min.alphaScore ?? 0).toBeGreaterThanOrEqual(0);
    expect(extremes._max.alphaScore ?? 0).toBeLessThanOrEqual(100);
  });

  spec('records a snapshot stamped with the config version that produced it', async () => {
    const config = await getActiveScoringConfig();
    const snapshot = await prisma.parcelScoreSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.configVersion).toBe(config.version);
  });

  spec('re-scoring the same parcel is deterministic', async () => {
    const parcel = await prisma.parcelOpportunity.findFirst({
      where: { apn: 'FX-010-0001-00010' },
      select: { id: true, alphaScore: true },
    });
    const first = await scoreParcelById(parcel!.id);
    const second = await scoreParcelById(parcel!.id);
    expect(second.alphaScore).toBe(first.alphaScore);
    expect(second.rejected).toBe(first.rejected);
  });

  spec('leaves a parcel unvalued rather than inventing a number', async () => {
    // Florida tax-sale records carry no acreage, so no comps-based valuation is
    // possible. The correct outcome is an absent value, not a guess.
    const unvalued = await prisma.parcelOpportunity.findFirst({
      where: { acreage: null, state: 'FL' },
      select: { id: true, quickSaleValue: true, valuationConfidence: true },
    });
    if (!unvalued) return;
    expect(unvalued.quickSaleValue).toBeNull();
    expect(unvalued.valuationConfidence).toBe('UNKNOWN');
  });
});

describe('valuation integration', () => {
  spec('orders retail above quick sale for a real parcel', async () => {
    const parcel = await prisma.parcelOpportunity.findFirst({
      where: { apn: 'FX-010-0001-00010' },
      select: { id: true },
    });
    const outcome = await valuateParcel(parcel!.id);
    expect(outcome.valuation.retail).not.toBeNull();
    expect(outcome.valuation.retail!.mid).toBeGreaterThan(outcome.valuation.quickSale!.mid);
    expect(outcome.economics).not.toBeNull();
    expect(outcome.economics!.allInBasis).toBeGreaterThan(outcome.economics!.acquisitionPrice);
  });

  spec('records the comparables actually used, with their adjustments', async () => {
    const parcel = await prisma.parcelOpportunity.findFirst({
      where: { apn: 'FX-010-0001-00010' },
      select: { id: true },
    });
    const links = await prisma.comparableLink.findMany({
      where: { parcelId: parcel!.id },
      take: 5,
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(toCents(link.adjustedPricePerAcre)).toBeGreaterThan(0);
      expect(Array.isArray(link.adjustments)).toBe(true);
      expect((link.adjustments as unknown[]).length).toBeGreaterThan(0);
    }
  });
});

describe('ingestion integrity', () => {
  spec('assigns every parcel a unique natural key', async () => {
    const duplicates = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM (
        SELECT "naturalKey" FROM "ParcelOpportunity"
        GROUP BY "naturalKey" HAVING COUNT(*) > 1
      ) duplicates
    `;
    expect(Number(duplicates[0]!.count)).toBe(0);
  });

  spec('normalises APNs consistently for matching', async () => {
    const parcels = await prisma.parcelOpportunity.findMany({
      where: { apn: { not: null } },
      select: { apn: true, apnNormalized: true },
      take: 200,
    });
    for (const parcel of parcels) {
      expect(parcel.apnNormalized).toBe(normalizeApn(parcel.apn!));
    }
  });

  spec('records provenance for parcels the engines have enriched', async () => {
    const parcel = await prisma.parcelOpportunity.findFirst({
      where: { apn: 'FX-010-0001-00010' },
      select: { id: true },
    });
    const evidence = await prisma.evidence.findMany({ where: { parcelId: parcel!.id } });
    expect(evidence.length).toBeGreaterThan(0);
    for (const row of evidence) {
      expect(row.source).toBeTruthy();
      expect(row.extractionMethod).toBeTruthy();
      expect(row.retrievalDate).toBeInstanceOf(Date);
    }
  });
});
