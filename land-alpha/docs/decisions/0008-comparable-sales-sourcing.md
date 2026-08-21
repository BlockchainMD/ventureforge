# 0008 — Comparable-sales sourcing, and what to do when there are none

Status: accepted · 2026-08-21

## Context

Every downstream number in Land Alpha — quick-sale value, all-in basis, ratio,
Alpha Score, maximum bid — descends from a price per acre derived from recorded
comparable sales. Until now the only sales in the database were the development
fixtures, which are synthetic. A synthetic comp does not merely add noise: it
sets the median that an acquisition decision is made against.

So we went looking for real ones in the three target states, starting with the
counties we already ingest inventory from.

## What is actually available

Public, machine-readable vacant-land sales are rarer than expected.

| Source | Status | Finding |
| --- | --- | --- |
| Grant County, MN — Assessor tax-parcel sales layer | `ACTIVE` | Publishes sale date, amount, deeded acres, sale property class, a `goodsale` qualification flag and parcel geometry, without a token. **181 qualified vacant-land sales ingested.** |
| St. Louis County, MN — `ASSR_SalesCompFinder`, `ASSR_SalesStudy` | `TOKEN_REQUIRED` | The layers exist and are documented, but return HTTP 499 (token required) to anonymous requests. Not automated. |
| Orange County, FL — public parcel layer | `CANDIDATE` | Fewer than 20 qualified vacant sales are exposed. The usable path is the FL DOR NAL/SDF annual files, which is a separate importer. |
| Ottawa County, MI | `UNAVAILABLE` | The published parcel service carries no sale fields at all. |

Per the project's compliance posture (see `0006-legal-and-compliance-posture.md`),
a token-gated layer is a technical access protection. We do not work around it;
we record it as `TOKEN_REQUIRED` and give analysts a CSV path instead.

## The awkward result

**The county with real comparable sales has no tax-forfeited inventory, and the
counties with inventory publish no usable sales.** Grant County MN does not run
a forfeited-land programme of the kind we ingest. So the real comps and the real
parcels do not currently overlap, and every parcel in the database is still
valued off fixtures.

We considered inferring vacancy and arm's-length status from price and class
text in the counties that publish transfers but not determinations. We rejected
it: inferring "this looks like a vacant-land sale" from the price is circular,
because the price is the thing being explained. Both classifications are read
from the county's own fields or the row is rejected.

## Decision

1. **Build the ingestion path for real sales anyway**, and prove it against a
   live source. `packages/ingestion/src/comps` holds the adapter, registry,
   validation and persistence; `pnpm comps` runs it. Grant County is the
   working proof: 526 transfers discovered, 181 accepted, 276 rejected as not
   vacant land, 69 as not arm's-length.
2. **Register the unavailable sources honestly** rather than faking adapters,
   with the specific reason each one is not automated.
3. **Provide an analyst CSV import** (`importComparablesCsv`) for the counties
   that publish a file but no API. It requires vacant and qualified columns, or
   an explicit `assertAllVacantArmsLength` assertion by the analyst. It never
   assumes.
4. **Make fixture provenance impossible to miss**, since the gap is not closed:
   - `CompCandidate.isFixture` flows from the comp's source through
     `analyzeComps` into each `ComparableSummary`.
   - A valuation that used any fixture comp is **capped at `LOW` confidence**
     regardless of how tightly the comps agree. Tightness must not buy
     confidence the underlying data cannot support.
   - It carries a warning naming the count and saying plainly: *do not
     underwrite an acquisition against it.*
   - The parcel detail page shows a red banner and a `fixture` badge per comp.

After re-running the pipeline, all 283 valued parcels report `LOW`, and 252
carry the warning. Previously many reported `MEDIUM`.

## Consequences

- No parcel currently in the database can be underwritten. That is the correct
  state, and it is now visible rather than implied.
- Closing the gap means either an inventory source in a county with public
  sales, or a sales source in a county we already ingest. The FL DOR NAL/SDF
  importer is the highest-value next step: it covers all 67 Florida counties
  with one format, including the ones with inventory.
- The confidence cap is deliberately blunt. When real comps arrive for a
  county, its parcels' confidence rises on its own with no code change.
