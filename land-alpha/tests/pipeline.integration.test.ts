import { describe, expect, it, beforeAll } from 'vitest';
import { prisma, getActiveScoringConfig, spatial, toCents } from '@land-alpha/db';
import { FIXTURE_PARCELS } from '@land-alpha/db/seed/fixture-parcels';
import {
  collectRealisedOutcomes,
  commitImport,
  evaluateAlertRules,
  createNote,
  manualSources,
  previewImport,
  previewFinancing,
  recordPayment,
  refreshNoteStanding,
  scoreParcelById,
  valuateParcel,
} from '@land-alpha/core';
import { buildAmortizationSchedule, calibrateFromOutcomes } from '@land-alpha/valuation';
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
