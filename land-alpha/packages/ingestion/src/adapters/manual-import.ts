import type {
  AdapterContext,
  DiscoveredArtifact,
  NormalizedBatch,
  ParsedBatch,
  SourceAdapter,
} from '../adapter.js';

/**
 * The MANUAL_SOURCE adapter.
 *
 * Deliberately inert. Sources registered as manual are behind a CAPTCHA, a
 * login, a robots disallow, or a publishing format too unstable to parse
 * reliably. Rather than pretending to automate them, this adapter discovers
 * nothing, and the inventory arrives through the analyst import workflow in
 * `manual-import.ts` — where it becomes exactly the same ParcelOpportunity
 * record an automated source would produce, with the same provenance.
 *
 * Its existence is the mechanism that keeps "we don't circumvent access
 * controls" from turning into "we lose the county".
 */
export const manualImportAdapter: SourceAdapter = {
  key: 'manual-import',
  description:
    'Placeholder for sources that must be imported by an analyst rather than fetched automatically.',
  parserVersion: '1',

  async discover(_ctx: AdapterContext): Promise<DiscoveredArtifact[]> {
    return [];
  },

  async fetchAndParse(ctx: AdapterContext): Promise<ParsedBatch> {
    return {
      records: [],
      artifactKey: null,
      sourceUrl: ctx.source.sourceUrl,
      warnings: [
        'This source is registered MANUAL_SOURCE and is not fetched automatically. Use the manual import workflow.',
      ],
    };
  },

  async normalize(): Promise<NormalizedBatch> {
    return { items: [], rejected: [], warnings: [] };
  },
};
