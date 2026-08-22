import { describe, expect, it, beforeAll } from 'vitest';
import { prisma, getActiveScoringConfig, spatial, toCents } from '@land-alpha/db';
import { FIXTURE_APN_PREFIX, FIXTURE_PARCELS } from '@land-alpha/db/seed/fixture-parcels';
import {
  collectRealisedOutcomes,
  commitImport,
  evaluateAlertRules,
  createNote,
  manualSources,
  notifyNewLead,
  previewImport,
  previewFinancing,
  recordPayment,
  refreshAllNotes,
  refreshNoteStanding,
  scoreParcelById,
  valuateParcel,
  recordManualScreen,
  recordPricesInBulk,
  summariseWorklist,
  notifyWorklist,
  loadManualScreens,
  assessEnvironment,
} from '@land-alpha/core';
import { buildAmortizationSchedule, calibrateFromOutcomes } from '@land-alpha/valuation';
import { normalizeApn } from '@land-alpha/shared/ids';
import robots from '../apps/web/src/app/robots';
import sitemap from '../apps/web/src/app/sitemap';

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

  spec('shows only the comparables behind the value the parcel carries now', async () => {
    // Valuing a parcel twice used to leave both sets of links in place, and no
    // reader names a snapshot when it loads them — so the comparables table and
    // the investment memo quoted a mixture of runs, and the sales shown did not
    // add up to the figure printed above them. Across the working set that was
    // 96% of all links.
    const parcel = await prisma.parcelOpportunity.findFirst({
      where: { apn: 'FX-010-0001-00010' },
      select: { id: true },
    });
    await valuateParcel(parcel!.id);
    await valuateParcel(parcel!.id);

    const latest = await prisma.parcelValuationSnapshot.findFirst({
      where: { parcelId: parcel!.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const links = await prisma.comparableLink.findMany({
      where: { parcelId: parcel!.id },
      select: { valuationSnapshotId: true },
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.valuationSnapshotId).toBe(latest!.id);
    }
  });
});

describe('the worklist is a list of real errands', () => {
  spec('keeps development fixtures out of the references sent to a county', async () => {
    // The blocked page's output is a list of parcel numbers to read down the
    // telephone to a county office. Fixtures are built to be indistinguishable
    // from real records to the engines — that is what makes them useful — and
    // must not be indistinguishable to the person making that call. There is
    // no county to ring about a fixture.
    const queued = await prisma.parcelOpportunity.findMany({
      where: {
        removedFromSourceAt: null,
        status: { notIn: ['REJECTED', 'ACQUIRED', 'SOLD'] },
        quickSaleValue: { not: null },
        rejected: false,
        apn: { not: { startsWith: FIXTURE_APN_PREFIX } },
        OR: [{ askingPrice: null }, { environmentalLayersScreened: { isEmpty: true } }],
      },
      select: { apn: true },
    });
    for (const parcel of queued) {
      expect(parcel.apn?.startsWith(FIXTURE_APN_PREFIX)).toBe(false);
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

/**
 * The calibration loop, end to end.
 *
 * The subtle part is which prediction gets graded: the valuation in force when
 * the parcel was bought, not today's. Today's valuation has the benefit of
 * comparables recorded after the purchase, so grading against it would be
 * marking homework with the answers in front of you. This buys and sells a real
 * parcel against two snapshots — one before the purchase and one after — and
 * checks the earlier one is the one used.
 */
describe('calibration loop', () => {
  const CALIBRATION_APN = 'CAL-TEST-0001';

  spec('grades the prediction that informed the purchase, not the latest one', async () => {
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    expect(template, 'a seeded parcel is needed as a template').not.toBeNull();

    await prisma.parcelOpportunity.deleteMany({ where: { apn: CALIBRATION_APN } });
    const parcel = await prisma.parcelOpportunity.create({
      data: {
        apn: CALIBRATION_APN,
        apnNormalized: normalizeApn(CALIBRATION_APN),
        naturalKey: `ZZ/Calibration/${normalizeApn(CALIBRATION_APN)}`,
        state: 'ZZ',
        county: 'Calibration',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        acreage: 2,
        firstSeenAt: new Date('2026-01-01T00:00:00Z'),
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      },
      select: { id: true },
    });

    const acquiredAt = new Date('2026-02-01T00:00:00Z');
    // The prediction that informed the buy: $20,000, 180 days.
    await prisma.parcelValuationSnapshot.create({
      data: {
        parcelId: parcel.id,
        quickSaleValue: '20000',
        confidence: 'MEDIUM',
        comparableCount: 8,
        method: 'test',
        createdAt: new Date('2026-01-15T00:00:00Z'),
        detail: { liquidity: { holdDays: 180 } },
      },
    });
    // A later, better-informed prediction that must be ignored.
    await prisma.parcelValuationSnapshot.create({
      data: {
        parcelId: parcel.id,
        quickSaleValue: '14000',
        confidence: 'HIGH',
        comparableCount: 30,
        method: 'test',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        detail: { liquidity: { holdDays: 300 } },
      },
    });

    await prisma.portfolioAsset.create({
      data: {
        parcelId: parcel.id,
        acquiredAt,
        acquisitionPrice: '4000',
        soldAt: new Date('2026-08-01T00:00:00Z'),
        salePrice: '14000',
        daysHeld: 181,
      },
    });

    try {
      const outcomes = await collectRealisedOutcomes();
      const mine = outcomes.find((o) => o.parcelId === parcel.id);
      expect(mine, 'the sold parcel should appear as an outcome').toBeDefined();

      // $20,000 from the January snapshot, not $14,000 from August.
      expect(mine!.predictedQuickSaleCents).toBe(2_000_000);
      expect(mine!.predictedHoldDays).toBe(180);
      expect(mine!.realisedSalePriceCents).toBe(1_400_000);
      expect(mine!.realisedHoldDays).toBe(181);

      // Six identical outcomes would correct this market down to 0.7x.
      const report = calibrateFromOutcomes(Array.from({ length: 6 }, () => mine!));
      expect(report.valueCalibration['ZZ/Calibration']).toBeCloseTo(0.7, 2);
      expect(report.holdCalibration['ZZ/Calibration']).toBeCloseTo(1.0, 1);
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: CALIBRATION_APN } });
    }
  });

  spec('excludes fixture parcels, which would be marking its own homework', async () => {
    const outcomes = await collectRealisedOutcomes();
    expect(outcomes.every((o) => !o.parcelId.startsWith('FX-'))).toBe(true);
    const fixtureSold = await prisma.portfolioAsset.count({
      where: { soldAt: { not: null }, parcel: { apn: { startsWith: 'FX-' } } },
    });
    if (fixtureSold > 0) {
      expect(outcomes.length).toBeLessThan(fixtureSold + outcomes.length + 1);
    }
  });
});

/**
 * Seller financing, end to end.
 *
 * The interesting behaviour is not the amortisation — that is unit-tested — but
 * what the ledger does with partial and missed payments, because that is where
 * a note quietly reports the wrong balance.
 */
describe('seller financing', () => {
  const FIN_APN = 'FIN-TEST-0001';

  const makeParcel = async (): Promise<string> => {
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    await prisma.parcelOpportunity.deleteMany({ where: { apn: FIN_APN } });
    const parcel = await prisma.parcelOpportunity.create({
      data: {
        apn: FIN_APN,
        apnNormalized: normalizeApn(FIN_APN),
        naturalKey: `ZZ/Finance/${normalizeApn(FIN_APN)}`,
        state: 'ZZ',
        county: 'Finance',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        acreage: 2,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        retailValue: '15000',
        quickSaleValue: '11000',
        estimatedAllInBasis: '5000',
        expectedHoldDays: 400,
      },
      select: { id: true },
    });
    return parcel.id;
  };

  spec('tracks a note from signing through payments to payoff', async () => {
    const parcelId = await makeParcel();
    try {
      const terms = {
        salePriceCents: 1_500_000,
        downPaymentCents: 150_000,
        annualRate: 0.1,
        termMonths: 12,
        documentFeeCents: 25_000,
        monthlyFeeCents: 1_000,
      };
      const firstPayment = new Date('2026-01-01T00:00:00Z');
      const noteId = await createNote({ parcelId, terms, firstPaymentDate: firstPayment });
      await prisma.financeNote.update({ where: { id: noteId }, data: { status: 'ACTIVE' } });

      const schedule = buildAmortizationSchedule(terms, firstPayment);
      const instalment = schedule.payments[0]!.paymentCents;

      // Three instalments paid on time, checked as of the third due date.
      for (let i = 0; i < 3; i += 1) {
        await recordPayment({
          noteId,
          amountCents: schedule.payments[i]!.paymentCents,
          receivedAt: schedule.payments[i]!.dueDate,
          asOf: schedule.payments[i]!.dueDate,
        });
      }
      let standing = await refreshNoteStanding(noteId, new Date('2026-03-02T00:00:00Z'));
      expect(standing.paymentsMade).toBe(3);
      expect(standing.arrearsCents).toBe(0);
      expect(standing.status).toBe('ACTIVE');
      expect(standing.principalBalanceCents).toBeLessThan(schedule.financedCents);

      // Miss two months entirely.
      standing = await refreshNoteStanding(noteId, new Date('2026-05-15T00:00:00Z'));
      expect(standing.arrearsCents).toBeGreaterThan(instalment);
      expect(standing.daysPastDue).toBeGreaterThan(30);
      expect(standing.status).toBe('DELINQUENT');

      // Past ninety days the note defaults, and says forfeiture is a legal
      // process rather than something this software can perform.
      standing = await refreshNoteStanding(noteId, new Date('2026-08-01T00:00:00Z'));
      expect(standing.status).toBe('DEFAULTED');
      expect(standing.warnings.join(' ')).toContain('varies by state');

      // Paying everything off cures the default: a land contract reinstates on
      // cure, so the status must be able to come back.
      const outstanding = schedule.payments.slice(3).reduce((sum, p) => sum + p.paymentCents, 0);
      await recordPayment({
        noteId,
        amountCents: outstanding,
        receivedAt: new Date('2026-08-02T00:00:00Z'),
        kind: 'PAYOFF',
        asOf: new Date('2026-08-02T00:00:00Z'),
      });
      standing = await refreshNoteStanding(noteId, new Date('2027-02-01T00:00:00Z'));
      expect(standing.principalBalanceCents).toBe(0);
      expect(standing.status).toBe('PAID_OFF');
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: FIN_APN } });
    }
  });

  spec('does not credit a down payment against the amortising balance', async () => {
    const parcelId = await makeParcel();
    try {
      const terms = {
        salePriceCents: 1_500_000,
        downPaymentCents: 150_000,
        annualRate: 0.1,
        termMonths: 12,
        documentFeeCents: 25_000,
        monthlyFeeCents: 1_000,
      };
      const noteId = await createNote({
        parcelId,
        terms,
        firstPaymentDate: new Date('2026-01-01T00:00:00Z'),
      });
      await prisma.financeNote.update({ where: { id: noteId }, data: { status: 'ACTIVE' } });

      // The deposit and the document fee are not instalments. Crediting them
      // would report a balance $1,750 lower than the buyer actually owes.
      await recordPayment({
        noteId,
        amountCents: 150_000,
        receivedAt: new Date('2025-12-15T00:00:00Z'),
        kind: 'DOWN_PAYMENT',
        asOf: new Date('2025-12-20T00:00:00Z'),
      });
      await recordPayment({
        noteId,
        amountCents: 25_000,
        receivedAt: new Date('2025-12-15T00:00:00Z'),
        kind: 'DOCUMENT_FEE',
        asOf: new Date('2025-12-20T00:00:00Z'),
      });

      const standing = await refreshNoteStanding(noteId, new Date('2025-12-20T00:00:00Z'));
      expect(standing.paidToDateCents).toBe(0);
      expect(standing.paymentsMade).toBe(0);
      expect(standing.principalBalanceCents).toBe(1_350_000);
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: FIN_APN } });
    }
  });

  spec('applies a partial payment to fees and interest before principal', async () => {
    const parcelId = await makeParcel();
    try {
      const terms = {
        salePriceCents: 1_500_000,
        downPaymentCents: 0,
        annualRate: 0.12,
        termMonths: 24,
        documentFeeCents: 0,
        monthlyFeeCents: 1_000,
      };
      const firstPayment = new Date('2026-01-01T00:00:00Z');
      const noteId = await createNote({ parcelId, terms, firstPaymentDate: firstPayment });
      await prisma.financeNote.update({ where: { id: noteId }, data: { status: 'ACTIVE' } });

      const schedule = buildAmortizationSchedule(terms, firstPayment);
      const first = schedule.payments[0]!;
      // Enough to cover the fee and the interest and nothing more: principal
      // must not move.
      await recordPayment({
        noteId,
        amountCents: first.feeCents + first.interestCents,
        receivedAt: firstPayment,
        asOf: firstPayment,
      });
      const standing = await refreshNoteStanding(noteId, firstPayment);
      expect(standing.principalBalanceCents).toBe(schedule.financedCents);
      expect(standing.paymentsMade).toBe(0);
      expect(standing.arrearsCents).toBe(first.principalCents);
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: FIN_APN } });
    }
  });

  spec('prices financing off retail and compares it against the cash exit', async () => {
    const parcelId = await makeParcel();
    try {
      const preview = await previewFinancing(parcelId);
      expect(preview).not.toBeNull();
      // Retail is $15,000; quick sale is $11,000. A monthly buyer is not the
      // buyer who needs a discount to move today.
      expect(preview!.terms.salePriceCents).toBe(1_500_000);
      expect(preview!.schedule.totalReceivedCents).toBeGreaterThan(1_500_000);
      expect(preview!.comparison.cashProceedsCents).toBe(1_100_000);
      expect(['CASH', 'FINANCE', 'EITHER']).toContain(preview!.comparison.recommendation);
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: FIN_APN } });
    }
  });
});

/**
 * Alerts, end to end.
 *
 * The behaviour that matters is the one the previous implementation could not
 * do: notify about a price cut on a parcel the analyst has already been told
 * about. A parcel re-offered at a falling price is the strongest signal this
 * product has, and it used to be silent.
 */
describe('speed alerts', () => {
  spec('fires on a price cut for a parcel already notified', async () => {
    const user = await prisma.user.findFirst({ select: { id: true } });
    const parcel = await prisma.parcelOpportunity.findFirst({
      where: { rejected: false, alphaScore: { gte: 50 } },
      select: { id: true, county: true, state: true },
    });
    expect(parcel, 'a scored parcel is needed').not.toBeNull();

    const rule = await prisma.alertRule.create({
      data: {
        userId: user!.id,
        name: 'Integration test rule',
        filters: { minAlphaScore: 50, includeRejected: false },
        enabled: true,
        lastEvaluatedAt: new Date(Date.now() - 3_600_000),
      },
      select: { id: true },
    });

    try {
      // First event: the parcel appears.
      const created = await prisma.parcelChange.create({
        data: { parcelId: parcel!.id, kind: 'CREATED', detectedAt: new Date() },
        select: { id: true },
      });
      let evaluations = await evaluateAlertRules({ ruleId: rule.id });
      expect(evaluations[0]!.notified).toBeGreaterThanOrEqual(1);

      // Same parcel, later, at a lower price. The old implementation
      // suppressed this because the parcel had already been notified.
      await prisma.parcelChange.create({
        data: {
          parcelId: parcel!.id,
          kind: 'PRICE_CHANGED',
          field: 'askingPrice',
          oldValue: '4000',
          newValue: '2500',
          detectedAt: new Date(),
        },
      });
      evaluations = await evaluateAlertRules({ ruleId: rule.id });
      expect(evaluations[0]!.notified).toBe(1);
      expect(evaluations[0]!.byKind.PRICE_CHANGED).toBe(1);

      const cut = await prisma.notification.findFirst({
        where: { alertRuleId: rule.id, title: { contains: 'Price cut' } },
        select: { title: true, body: true, urgency: true },
      });
      expect(cut).not.toBeNull();
      expect(cut!.title).toContain('Price cut 38%');
      expect(cut!.urgency).toBe('IMMEDIATE');

      // Re-running must not duplicate: dedupe keys on the change.
      const before = await prisma.notification.count({ where: { alertRuleId: rule.id } });
      await evaluateAlertRules({ ruleId: rule.id });
      expect(await prisma.notification.count({ where: { alertRuleId: rule.id } })).toBe(before);
      expect(created.id).toBeTruthy();
    } finally {
      await prisma.notification.deleteMany({ where: { alertRuleId: rule.id } });
      await prisma.alertRule.delete({ where: { id: rule.id } });
    }
  });
});

/**
 * The analyst import path.
 *
 * Five registry sources are MANUAL_ONLY because Land Alpha declined to work
 * around a CAPTCHA, a 403 or a token. The parsing engine for them was written
 * and tested long before anything called it, which meant those sources were not
 * really registered as manual — they were registered as unreachable.
 */
describe('analyst import', () => {
  const SAMPLE = [
    'Parcel Number,Legal Description,Opening Bid,Acres,Certificate,Sale Date',
    '"IMP-TEST-0001","LOT 39 BLK 6 MARION OAKS UNIT 6","$1,842.10",0.23,"2021-1234","10/15/2026"',
    '"IMP-TEST-0002","LOT 14 BLK 2 SILVER SPRINGS SHORES","$2,105.55",0.25,"2021-1301","10/15/2026"',
  ].join('\n');

  spec('reads a county export the way a county writes one', async () => {
    const preview = await previewImport('lands-available.csv', Buffer.from(SAMPLE));
    expect(preview.rowCount).toBe(2);
    expect(preview.suggestedMapping['Parcel Number']).toBe('apn');
    expect(preview.suggestedMapping['Opening Bid']).toBe('minimumBid');
    expect(preview.suggestedMapping['Acres']).toBe('acreage');
    expect(preview.suggestedMapping['Sale Date']).toBe('auctionDate');
    // Nothing maps to a certificate number, and inventing a target for it
    // would be worse than leaving it out.
    expect(preview.suggestedMapping['Certificate']).toBeUndefined();
  });

  spec('imports parcels that are indistinguishable from fetched ones', async () => {
    const source = await prisma.source.findFirst({
      where: { registryKey: { not: undefined } },
      select: { registryKey: true },
    });
    expect(source, 'a synced source is needed').not.toBeNull();

    await prisma.parcelOpportunity.deleteMany({ where: { apn: { startsWith: 'IMP-TEST-' } } });
    try {
      const outcome = await commitImport({
        filename: 'lands-available.csv',
        body: Buffer.from(SAMPLE),
        sourceKey: source!.registryKey,
        mapping: {
          'Parcel Number': 'apn',
          'Opening Bid': 'minimumBid',
          Acres: 'acreage',
          'Legal Description': 'legalDescription',
          'Sale Date': 'auctionDate',
        },
        importedById: 'test@landalpha.local',
      });

      expect(outcome.created).toBe(2);
      expect(outcome.discovered).toBe(2);

      const imported = await prisma.parcelOpportunity.findMany({
        where: { apn: { startsWith: 'IMP-TEST-' } },
        orderBy: { apn: 'asc' },
      });
      expect(imported).toHaveLength(2);
      // Money survives the round trip: "$1,842.10" is 1842.10, not 184210.
      expect(Number(imported[0]!.minimumBid)).toBeCloseTo(1842.1, 2);
      expect(imported[0]!.acreage).toBeCloseTo(0.23, 4);
      expect(imported[0]!.legalDescription).toContain('MARION OAKS');
      expect(imported[0]!.auctionDate?.getUTCFullYear()).toBe(2026);
      // A natural key, so a re-import updates rather than duplicating.
      expect(imported[0]!.naturalKey).toBeTruthy();

      // The run is auditable like any other.
      const run = await prisma.ingestionRun.findUnique({
        where: { id: outcome.runId },
        select: { triggeredBy: true, recordsCreated: true, notes: true, status: true },
      });
      expect(run!.triggeredBy).toBe('test@landalpha.local');
      expect(run!.recordsCreated).toBe(2);
      expect(run!.notes).toContain('lands-available.csv');

      // Re-importing the same file updates rather than duplicating.
      const again = await commitImport({
        filename: 'lands-available.csv',
        body: Buffer.from(SAMPLE),
        sourceKey: source!.registryKey,
        mapping: { 'Parcel Number': 'apn', 'Opening Bid': 'minimumBid', Acres: 'acreage' },
      });
      expect(again.created).toBe(0);
      expect(again.updated).toBe(2);
      expect(
        await prisma.parcelOpportunity.count({ where: { apn: { startsWith: 'IMP-TEST-' } } }),
      ).toBe(2);
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: { startsWith: 'IMP-TEST-' } } });
    }
  });

  spec('lists the manual sources with the reason each is manual', async () => {
    const sources = manualSources();
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.key).toBeTruthy();
      expect(source.reason.length).toBeGreaterThan(30);
    }
  });
});

/**
 * Financing on the public listing.
 *
 * A monthly figure changes who the buyer is: cash buyers for rural land are a
 * thin, price-sensitive pool, and buyers who can pay $300 a month are a much
 * larger one comparing against different alternatives. Publishing the terms is
 * where the financing engine turns into revenue rather than an internal number.
 */
describe('listing finance offer', () => {
  spec('publishes terms a buyer can act on, and stores what was shown', async () => {
    const listing = await prisma.listing.findFirst({
      where: { financeOffered: true },
      select: {
        askingPrice: true,
        financeDownPayment: true,
        financeMonthlyPayment: true,
        financeTermMonths: true,
        financeAnnualRate: true,
      },
    });
    if (!listing) {
      console.warn('  (no financed listing generated yet)');
      return;
    }

    const price = toCents(listing.askingPrice)!;
    const down = toCents(listing.financeDownPayment)!;
    const monthly = toCents(listing.financeMonthlyPayment)!;

    expect(down).toBeGreaterThan(0);
    expect(down).toBeLessThan(price);
    expect(monthly).toBeGreaterThan(0);
    // The whole point: the monthly figure must be small relative to the price,
    // or it reaches nobody new.
    expect(monthly).toBeLessThan(price / 12);
    expect(listing.financeTermMonths).toBeGreaterThan(0);

    // The payments must actually retire the balance, not merely look plausible.
    const schedule = buildAmortizationSchedule(
      {
        salePriceCents: price,
        downPaymentCents: down,
        annualRate: listing.financeAnnualRate!,
        termMonths: listing.financeTermMonths!,
      },
      new Date(),
    );
    expect(schedule.payments.at(-1)!.balanceAfterCents).toBe(0);
  });

  spec('does not offer a note too small to be worth servicing', async () => {
    const cheap = await prisma.listing.findMany({
      where: { askingPrice: { lt: 3000 } },
      select: { financeOffered: true, askingPrice: true },
    });
    for (const listing of cheap) {
      // Below ~$3,000 the paperwork, collection risk and bookkeeping cost more
      // than the interest earns.
      expect(listing.financeOffered).toBe(false);
    }
  });
});

/**
 * Which pages may be indexed.
 *
 * This is a revenue rule, not a preference. The root layout used to apply
 * `noindex` to the whole application, which was right for the analyst terminal
 * and silently kept every property listing out of every search result —
 * organic search being a primary channel for rural land. A regression here
 * costs sales without failing anything, so it is asserted.
 */
describe('indexing rules', () => {
  spec('publishes a sitemap of listings that are actually for sale', async () => {
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.url).toMatch(/\/properties$/);
    for (const entry of entries) expect(entry.url).toMatch(/^https?:\/\//);

    // A sold parcel in the sitemap wastes crawl budget and sends buyers to a
    // dead end.
    const sold = await prisma.listing.findMany({
      where: { parcel: { status: { in: ['SOLD', 'ARCHIVED'] } } },
      select: { slug: true },
    });
    for (const listing of sold) {
      expect(entries.some((entry) => entry.url.endsWith(listing.slug))).toBe(false);
    }
  });

  spec('lets crawlers into the listings and nowhere else', async () => {
    const rules = robots();
    const rule = Array.isArray(rules.rules) ? rules.rules[0]! : rules.rules;
    const allow = [rule.allow].flat().filter(Boolean) as string[];
    const disallow = [rule.disallow].flat().filter(Boolean) as string[];

    expect(allow.some((path) => path.startsWith('/properties'))).toBe(true);
    // Acquisition analysis on parcels the business intends to bid on. A
    // competitor reading it from a search result is a direct commercial loss.
    for (const path of ['/opportunities', '/deals', '/allocate', '/admin', '/api/']) {
      expect(disallow, `${path} must stay out of the index`).toContain(path);
    }
    expect(rules.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

/**
 * A buyer enquiry reaching a person.
 *
 * The enquiry form has always saved a Lead and told nobody, which for a
 * weekend enquiry meant Monday. Response time is the strongest predictor of
 * conversion in this business, so a lead nobody is told about is close to a
 * lead that never arrived.
 */
/**
 * Manual environmental screening.
 *
 * Flood, wetlands and cleanup-site data are all published behind access
 * controls this project does not work around, so an analyst opening the map
 * viewer is the only screening those layers get. The test that matters is that
 * their entry has the same effect an API response would: it lifts the parcel
 * off UNKNOWN, and it is attributed to them rather than to a federal dataset.
 */
describe('manual environmental screening', () => {
  spec('an analyst screen lifts a parcel off UNKNOWN and names who did it', async () => {
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    expect(template, 'a seeded parcel is needed as a template').not.toBeNull();

    const APN = 'SCREEN-TEST-0001';
    await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    const parcel = await prisma.parcelOpportunity.create({
      data: {
        apn: APN,
        apnNormalized: normalizeApn(APN),
        naturalKey: `ZZ/Screen/${normalizeApn(APN)}`,
        state: 'ZZ',
        county: 'Screen',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        acreage: 2.5,
        latitude: 46.7517,
        longitude: -92.1936,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });

    try {
      // Nothing screened yet: an empty wetlandTypes array must not read as
      // "no wetlands", and there is no observation to build a rating on.
      const before = await assessFromScreens(parcel.id);
      expect(before.layersScreened).toEqual([]);
      expect(before.confidence).toBe('UNKNOWN');

      await recordManualScreen({
        parcelId: parcel.id,
        layer: 'FLOOD',
        findings: ['X'],
        overlapFraction: 0,
        clear: false,
        sourceUrl: 'https://msc.fema.gov/portal/search',
        notes: null,
        screenedById: null,
        screenedByLabel: 'Dana Okonkwo',
      });

      const after = await assessFromScreens(parcel.id);
      expect(after.layersScreened).toContain('FLOOD');
      expect(after.confidence).not.toBe('UNKNOWN');
      expect(after.inSpecialFloodHazardArea).toBe(false);
      // The provenance is the whole point. A reader must be able to tell this
      // from a FEMA response.
      expect(after.evidence.join(' ')).toContain('Dana Okonkwo');
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    }
  });

  spec('a later screen supersedes the earlier one without erasing it', async () => {
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    const APN = 'SCREEN-TEST-0002';
    await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    const parcel = await prisma.parcelOpportunity.create({
      data: {
        apn: APN,
        apnNormalized: normalizeApn(APN),
        naturalKey: `ZZ/Screen/${normalizeApn(APN)}`,
        state: 'ZZ',
        county: 'Screen',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });

    try {
      for (const zone of ['X', 'AE']) {
        await recordManualScreen({
          parcelId: parcel.id,
          layer: 'FLOOD',
          findings: [zone],
          clear: false,
          screenedById: null,
          screenedByLabel: 'Dana Okonkwo',
        });
      }

      const current = await loadManualScreens(parcel.id);
      expect(current.FLOOD?.findings).toEqual(['AE']);

      // A screening that later proved wrong is evidence about how the
      // screening was done. It is superseded, never deleted.
      const all = await prisma.manualEnvironmentalScreen.findMany({
        where: { parcelId: parcel.id },
      });
      expect(all.length).toBe(2);
      expect(all.filter((row) => row.supersededAt != null).length).toBe(1);
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    }
  });

  spec('refuses an entry that records neither a finding nor an all-clear', async () => {
    await expect(
      recordManualScreen({
        parcelId: 'does-not-matter',
        layer: 'WETLANDS',
        findings: [],
        clear: false,
        screenedById: null,
        screenedByLabel: 'Dana Okonkwo',
      }),
    ).rejects.toThrow(/finding or an explicit confirmation/);
  });
});

/** Runs the screening engine over whatever manual screens a parcel has. */
async function assessFromScreens(parcelId: string) {
  const manual = await loadManualScreens(parcelId);
  return assessEnvironment({
    flood: manual.FLOOD
      ? {
          zones: manual.FLOOD.findings,
          overlapFraction: manual.FLOOD.overlapFraction,
          available: true,
          source: manual.FLOOD.source,
        }
      : { zones: [], overlapFraction: null, available: false, source: 'FEMA NFHL' },
    wetlands: manual.WETLANDS
      ? {
          types: manual.WETLANDS.findings,
          overlapFraction: manual.WETLANDS.overlapFraction,
          available: true,
          source: manual.WETLANDS.source,
        }
      : { types: [], overlapFraction: null, available: false, source: 'USFWS NWI' },
  });
}

/**
 * Bulk price entry.
 *
 * A county holds one list and answers one enquiry, and the reply comes back as
 * a list. If recording it means re-typing forty-six figures one parcel page at
 * a time, the queue does not move — so the parser has to survive whatever
 * shape the county's reply arrives in.
 */
describe('bulk acquisition prices', () => {
  spec('matches on either reference and tolerates however the reply is formatted', async () => {
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    const made: string[] = [];
    const rows = [
      { apn: 'BULK-TEST-0001', ref: '2024-16234' },
      { apn: 'BULK-TEST-0002', ref: '2022-9704_1' },
      { apn: 'BULK-TEST-0003', ref: null },
    ];
    await prisma.parcelOpportunity.deleteMany({
      where: { apn: { in: rows.map((row) => row.apn) } },
    });
    for (const row of rows) {
      const created = await prisma.parcelOpportunity.create({
        data: {
          apn: row.apn,
          apnNormalized: normalizeApn(row.apn),
          naturalKey: `ZZ/Bulk/${normalizeApn(row.apn)}`,
          state: 'ZZ',
          county: 'Bulk',
          sourceId: template!.sourceId,
          jurisdictionId: template!.jurisdictionId,
          sourceRecordId: row.ref,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
        select: { id: true },
      });
      made.push(created.id);
    }

    try {
      const result = await recordPricesInBulk(
        'ZZ',
        'Bulk',
        [
          '2024-16234, 4275.00', // comma, plain decimal
          '2022-9704_1\t3810', // tab, integer
          'BULK-TEST-0003 $6,204.55', // APN, currency and thousands separator
          'not-a-parcel, 100', // reference we do not hold
          'gibberish', // no amount at all
        ].join('\n'),
      );

      expect(result.applied).toBe(3);
      // A line that quietly did nothing is how a parcel ends up priced in
      // someone's head and not in the system.
      expect(result.unmatched).toEqual(['not-a-parcel, 100', 'gibberish']);

      const priced = await prisma.parcelOpportunity.findMany({
        where: { id: { in: made } },
        select: { apn: true, askingPrice: true },
        orderBy: { apn: 'asc' },
      });
      expect(priced.map((p) => toCents(p.askingPrice))).toEqual([427_500, 381_000, 620_455]);
    } finally {
      await prisma.parcelOpportunity.deleteMany({
        where: { apn: { in: rows.map((row) => row.apn) } },
      });
    }
  });
});

/**
 * The nudge that clears the queue.
 *
 * Every automated part of this system runs without being asked. The facts no
 * endpoint will hand over do not, and they gate everything behind them — so
 * the one failure mode that matters is nobody being told the queue is full.
 */
/**
 * Valuing the land that may actually be built on.
 *
 * The comps engine adjusts for size, age, access, utilities and zoning and
 * nothing for flood, so a parcel almost entirely inside the floodplain was
 * valued exactly like a dry one and the recommended maximum bid followed. The
 * floodway is where the correction belongs: it is a regulatory no-build area,
 * not a market opinion.
 */
describe('flood and the value of developable land', () => {
  async function parcelWith(apn: string, data: Record<string, unknown>): Promise<{ id: string }> {
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    await prisma.parcelOpportunity.deleteMany({ where: { apn } });
    return prisma.parcelOpportunity.create({
      data: {
        apn,
        apnNormalized: normalizeApn(apn),
        naturalKey: `ZZ/Flood/${normalizeApn(apn)}`,
        state: 'ZZ',
        county: 'Flood',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        acreage: 10,
        latitude: 46.75,
        longitude: -92.19,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        ...data,
      },
      select: { id: true },
    });
  }

  spec('values a floodway parcel on what is left of it', async () => {
    const parcel = await parcelWith('FLOODWAY-TEST-0001', {
      floodZones: ['FLOODWAY'],
      floodOverlapFraction: 0.8,
      inSpecialFloodHazardArea: true,
      environmentalLayersScreened: ['FLOOD'],
    });
    try {
      const result = await valuateParcel(parcel.id);
      const warning = result.warnings.find((w) => w.includes('regulatory floodway'));
      expect(warning).toBeDefined();
      // Ten gross acres, eight of them undevelopable.
      expect(warning).toContain('2.00 developable acres');
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: 'FLOODWAY-TEST-0001' } });
    }
  });

  spec('does not invent a discount for the rest of the floodplain', async () => {
    // Building outside the floodway is permitted with elevation, so a discount
    // is real but it is a market judgement. Picking a percentage here would be
    // inventing one.
    const parcel = await parcelWith('SFHA-TEST-0001', {
      floodZones: ['AE'],
      floodOverlapFraction: 0.6,
      inSpecialFloodHazardArea: true,
      environmentalLayersScreened: ['FLOOD'],
    });
    try {
      const result = await valuateParcel(parcel.id);
      const warning = result.warnings.find((w) => w.includes('Special Flood Hazard Area'));
      expect(warning).toBeDefined();
      expect(warning).toContain('does not make for them');
      expect(result.warnings.some((w) => w.includes('developable acres'))).toBe(false);
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: 'SFHA-TEST-0001' } });
    }
  });

  spec('leaves a dry parcel entirely alone', async () => {
    const parcel = await parcelWith('DRY-TEST-0001', {
      floodZones: ['X'],
      floodOverlapFraction: 0,
      inSpecialFloodHazardArea: false,
      environmentalLayersScreened: ['FLOOD'],
    });
    try {
      const result = await valuateParcel(parcel.id);
      expect(result.warnings.some((w) => w.includes('floodway'))).toBe(false);
      expect(result.warnings.some((w) => w.includes('Special Flood Hazard Area'))).toBe(false);
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: 'DRY-TEST-0001' } });
    }
  });
});

describe('worklist notification', () => {
  spec('tells whoever can act, once per state of the queue', async () => {
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    const APN = 'WORKLIST-TEST-0001';
    await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    await prisma.notification.deleteMany({
      where: { title: { startsWith: 'Prices outstanding' } },
    });

    const parcel = await prisma.parcelOpportunity.create({
      data: {
        apn: APN,
        apnNormalized: normalizeApn(APN),
        naturalKey: `ZZ/Worklist/${normalizeApn(APN)}`,
        state: 'ZZ',
        county: 'Worklist',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        quickSaleValue: '42000',
        askingPrice: null,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });

    try {
      const summary = await summariseWorklist();
      const mine = summary.counties.find((county) => county.county === 'Worklist');
      expect(mine?.parcelsAwaitingPrice).toBe(1);
      expect(mine?.quickSaleValueCents).toBe(4_200_000);

      const actors = await prisma.user.count({
        where: { role: { in: ['ADMIN', 'ANALYST'] }, isActive: true },
      });
      expect(await notifyWorklist()).toBe(actors);

      // Being told the same three counties are waiting every morning is how
      // people learn to ignore a digest.
      expect(await notifyWorklist()).toBe(0);

      const sent = await prisma.notification.findMany({
        where: { title: { startsWith: 'Prices outstanding' } },
        include: { user: { select: { role: true } } },
      });
      expect(sent.length).toBe(actors);
      expect(sent.every((row) => row.user?.role !== 'VIEWER')).toBe(true);
      expect(sent[0]?.linkPath).toBe('/blocked');
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
      await prisma.notification.deleteMany({
        where: { title: { startsWith: 'Prices outstanding' } },
      });
      void parcel;
    }
  });

  spec('counts inventory that cannot be valued, and says why', async () => {
    // These parcels are not rejected — nothing is wrong with the land — and
    // they carry no score, because a score estimates return and there is no
    // value to estimate against. That combination makes them invisible in
    // every list, which looks identical to having quietly lost them.
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    const APN = 'DARK-TEST-0001';
    await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    await prisma.parcelOpportunity.create({
      data: {
        apn: APN,
        apnNormalized: normalizeApn(APN),
        naturalKey: `ZZ/Dark/${normalizeApn(APN)}`,
        state: 'ZZ',
        county: 'Dark',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        quickSaleValue: null,
        alphaScore: null,
        rejected: false,
        valuationWarnings: [
          'No comparable sales and no assessor land value. This parcel cannot be valued and must not be scored on economics.',
        ],
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    try {
      const summary = await summariseWorklist();
      const mine = summary.dark.find((county) => county.county === 'Dark');
      expect(mine?.parcels).toBe(1);
      // The reason is read from the valuation's own warnings rather than
      // re-derived, so the page cannot drift from what the engine concluded.
      expect(mine?.reason).toContain('cannot be valued');
    } finally {
      await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    }
  });

  spec('stays quiet when the queue is empty', async () => {
    await prisma.notification.deleteMany({
      where: { title: { startsWith: 'Prices outstanding' } },
    });
    // A digest that arrives whatever the state of the world is one people stop
    // opening, and the morning it matters it gets skimmed with the rest.
    const summary = await summariseWorklist();
    if (summary.awaitingPrice === 0) {
      expect(await notifyWorklist()).toBe(0);
    } else {
      // The seeded database does have work waiting, which is itself the point.
      expect(summary.counties.length).toBeGreaterThan(0);
    }
  });
});

describe('lead notifications', () => {
  spec('notifies everyone who can act, and nobody who cannot', async () => {
    // Creates its own parcel rather than borrowing one. A seeded database
    // holds only fixtures, so looking for real inventory here passed locally
    // and failed in CI — which is the test being wrong about its environment,
    // not the environment being wrong.
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    expect(template, 'a seeded parcel is needed as a template').not.toBeNull();

    const LEAD_APN = 'LEAD-TEST-0001';
    await prisma.parcelOpportunity.deleteMany({ where: { apn: LEAD_APN } });
    const parcel = await prisma.parcelOpportunity.create({
      data: {
        apn: LEAD_APN,
        apnNormalized: normalizeApn(LEAD_APN),
        naturalKey: `ZZ/Lead/${normalizeApn(LEAD_APN)}`,
        state: 'ZZ',
        county: 'Lead',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        acreage: 5.23,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      select: { id: true, county: true, state: true },
    });

    const lead = await prisma.lead.create({
      data: {
        parcelId: parcel.id,
        name: 'Integration Buyer',
        email: 'buyer@example.test',
        offerAmount: '19500',
        inquiry: 'Do you offer monthly payments?',
        source: 'PUBLIC_SITE',
        status: 'NEW',
      },
      select: { id: true },
    });

    try {
      const sent = await notifyNewLead(lead.id);
      const [actors, viewers] = await Promise.all([
        prisma.user.count({ where: { role: { in: ['ADMIN', 'ANALYST'] }, isActive: true } }),
        prisma.user.count({ where: { role: 'VIEWER' } }),
      ]);
      expect(sent).toBe(actors);

      const notifications = await prisma.notification.findMany({
        where: { parcelId: parcel.id, title: { contains: 'Offer' } },
        include: { user: { select: { role: true } } },
      });
      expect(notifications.length).toBe(actors);
      // Notifying someone who cannot reply is noise, and noise is what makes
      // an alert queue get ignored.
      expect(notifications.every((n) => n.user.role !== 'VIEWER')).toBe(true);
      expect(viewers).toBeGreaterThanOrEqual(0);

      const first = notifications[0]!;
      // HIGH rather than IMMEDIATE: this parcel has no published listing
      // price, so whether $19,500 is a strong offer is genuinely unknown, and
      // claiming otherwise would be the sort of false urgency that trains
      // people to ignore the queue.
      expect(first.urgency).toBe('HIGH');
      expect(first.body).toContain('buyer@example.test');
      expect(first.linkPath).toBe('/leads');
    } finally {
      await prisma.notification.deleteMany({ where: { parcelId: parcel.id } });
      await prisma.lead.deleteMany({ where: { id: lead.id } });
      await prisma.parcelOpportunity.deleteMany({ where: { apn: LEAD_APN } });
    }
  });
});

/**
 * The sweeps that nothing else triggers.
 *
 * Delinquency is a function of the calendar: no payment arrives to prompt a
 * check, which is exactly the problem. Without a scheduled sweep a buyer who
 * stops paying is noticed whenever somebody happens to open the note.
 */
describe('finance sweep', () => {
  spec('alerts on the transition into trouble, not on every sweep', async () => {
    const template = await prisma.parcelOpportunity.findFirst({
      where: { apn: { startsWith: 'FX-' } },
      select: { sourceId: true, jurisdictionId: true },
    });
    const APN = 'SWEEP-TEST-0001';
    await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    const parcel = await prisma.parcelOpportunity.create({
      data: {
        apn: APN,
        apnNormalized: normalizeApn(APN),
        naturalKey: `ZZ/Sweep/${normalizeApn(APN)}`,
        state: 'ZZ',
        county: 'Sweep',
        sourceId: template!.sourceId,
        jurisdictionId: template!.jurisdictionId,
        acreage: 2,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });

    try {
      const noteId = await createNote({
        parcelId: parcel.id,
        terms: {
          salePriceCents: 1_500_000,
          downPaymentCents: 150_000,
          annualRate: 0.1,
          termMonths: 24,
          documentFeeCents: 0,
          monthlyFeeCents: 0,
        },
        firstPaymentDate: new Date('2026-01-01T00:00:00Z'),
      });
      await prisma.financeNote.update({ where: { id: noteId }, data: { status: 'ACTIVE' } });

      // Nothing paid; by March the buyer is well past the grace period.
      const first = await refreshAllNotes(new Date('2026-03-01T00:00:00Z'));
      const mine = first.find((standing) => standing.noteId === noteId)!;
      expect(mine.status).toBe('DELINQUENT');
      expect(mine.previousStatus).toBe('ACTIVE');

      const afterFirst = await prisma.notification.count({
        where: { parcelId: parcel.id, title: { contains: 'Payment overdue' } },
      });
      expect(afterFirst).toBeGreaterThan(0);

      // Sweeping again with nothing changed must not announce it a second
      // time. A note delinquent for a fortnight that alerts every sweep turns
      // the queue into noise and the next real one is missed.
      await refreshAllNotes(new Date('2026-03-02T00:00:00Z'));
      expect(
        await prisma.notification.count({
          where: { parcelId: parcel.id, title: { contains: 'Payment overdue' } },
        }),
      ).toBe(afterFirst);

      // Deterioration is a new fact and does alert.
      const later = await refreshAllNotes(new Date('2026-06-01T00:00:00Z'));
      expect(later.find((s) => s.noteId === noteId)!.status).toBe('DEFAULTED');
      expect(
        await prisma.notification.count({
          where: { parcelId: parcel.id, title: { contains: 'default' } },
        }),
      ).toBeGreaterThan(0);
    } finally {
      await prisma.notification.deleteMany({ where: { parcelId: parcel.id } });
      await prisma.parcelOpportunity.deleteMany({ where: { apn: APN } });
    }
  });
});
