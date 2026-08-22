import { prisma, sourcesDueForRefresh, getQueue } from '@land-alpha/db';
import { resolveSource, runSource, syncRegistry } from '@land-alpha/ingestion';
import '@land-alpha/ingestion/adapters/index';
import {
  discoverSources,
  enrichParcel,
  evaluateAlertRules,
  refreshAllNotes,
  runCalibration,
  generateListingForParcel,
  generateMemoForParcel,
  scoreParcelById,
  valuateParcel,
} from '@land-alpha/core';
import type { JobHandlerMap } from '@land-alpha/shared/queue';
import { createLogger } from '@land-alpha/shared/logger';

/**
 * Job handlers.
 *
 * Each handler is idempotent and safe to retry: ingestion upserts on a natural
 * key, enrichment and scoring overwrite derived fields, and memo generation
 * appends a new version rather than mutating an old one.
 */

const logger = createLogger({ component: 'worker' });

export const handlers: JobHandlerMap = {
  'source.ingest': async (payload) => {
    const resolved = await resolveSource(payload.sourceId);
    if (!resolved) throw new Error(`Source ${payload.sourceId} has no registry definition`);

    const outcome = await runSource(resolved.sourceId, resolved.entry, {
      triggeredBy: payload.triggeredBy ?? 'worker',
    });

    // New and materially-changed parcels are re-enriched and re-scored, so the
    // funnel reflects the change without re-processing an entire county.
    const queue = await getQueue();
    for (const parcelId of outcome.parcelIdsNeedingEnrichment) {
      await queue.enqueue(
        'parcel.enrich',
        { parcelId },
        { dedupeKey: `parcel.enrich:${parcelId}` },
      );
    }
    if (outcome.created > 0 || outcome.changed > 0) {
      await queue.enqueue('alert.evaluate', {}, { dedupeKey: 'alert.evaluate' });
      // Money already out of the door: a buyer who stops paying should be
      // noticed in days, not whenever somebody opens the note.
      await queue.enqueue('finance.sweep', {}, { dedupeKey: 'finance.sweep' });
    }

    return {
      status: outcome.status,
      created: outcome.created,
      changed: outcome.changed,
      removed: outcome.removed,
      rejected: outcome.rejected,
      priceReductions: outcome.priceReductions,
    };
  },

  'parcel.enrich': async (payload) => {
    const summary = await enrichParcel(payload.parcelId, {
      stages: payload.stages as never,
    });
    const queue = await getQueue();
    await queue.enqueue(
      'parcel.valuate',
      { parcelId: payload.parcelId },
      { dedupeKey: `parcel.valuate:${payload.parcelId}` },
    );
    return summary;
  },

  'parcel.valuate': async (payload) => {
    const outcome = await valuateParcel(payload.parcelId);
    const queue = await getQueue();
    await queue.enqueue(
      'parcel.score',
      { parcelId: payload.parcelId },
      { dedupeKey: `parcel.score:${payload.parcelId}` },
    );
    return {
      compCount: outcome.valuation.compCount,
      quickSaleValue: outcome.valuation.quickSale?.mid ?? null,
      basisToQsv: outcome.economics?.basisToQsv ?? null,
    };
  },

  'parcel.score': async (payload) => {
    const result = await scoreParcelById(payload.parcelId);
    return {
      alphaScore: result.alphaScore,
      rejected: result.rejected,
      confidence: result.confidenceLevel,
    };
  },

  'parcel.memo': async (payload) => generateMemoForParcel(payload.parcelId, payload.requestedBy),

  'parcel.listing': async (payload) =>
    generateListingForParcel(payload.parcelId, payload.requestedBy),

  'alert.evaluate': async (payload) => evaluateAlertRules({ ruleId: payload.alertId }),

  /**
   * Re-evaluate every live seller-financed note. Delinquency is a function of
   * the calendar, so nothing else will surface it — no payment arrives to
   * trigger a check, which is precisely the problem.
   */
  'finance.sweep': async () => {
    const standings = await refreshAllNotes();
    const behind = standings.filter((standing) => standing.arrearsCents > 0).length;
    return { notes: standings.length, behind };
  },

  /**
   * Grade past predictions against realised outcomes and apply what the
   * evidence supports. Reporting only would leave the engine wrong in a known
   * direction, which is worse than not knowing.
   */
  'calibration.run': async () => {
    const report = await runCalibration({ apply: true });
    return {
      outcomes: report.generatedFrom,
      marketsCorrected: Object.keys(report.valueCalibration).length,
    };
  },

  'source.discover': async (payload) =>
    discoverSources({
      state: payload.state,
      county: payload.county,
      requestedBy: payload.requestedBy,
    }),

  /**
   * Scheduled maintenance: sync the registry, then queue whichever sources are
   * due a refresh. This is the loop that makes the product continuously scan
   * approved government sources rather than waiting to be asked.
   */
  'maintenance.sourceHealth': async () => {
    await syncRegistry();
    const due = await sourcesDueForRefresh();
    const queue = await getQueue();

    for (const sourceId of due) {
      await queue.enqueue(
        'source.ingest',
        { sourceId, triggeredBy: 'scheduler' },
        { dedupeKey: `source.ingest:${sourceId}` },
      );
    }
    await queue.enqueue('alert.evaluate', {}, { dedupeKey: 'alert.evaluate' });

    const broken = await prisma.source.count({ where: { sourceStatus: 'BROKEN' } });
    logger.info('maintenance sweep complete', { queued: due.length, brokenSources: broken });
    return { queued: due.length, brokenSources: broken };
  },
};
