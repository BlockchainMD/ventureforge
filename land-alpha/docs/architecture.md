# Architecture

## The shape of the problem

Land Alpha has three hard parts, and they are hard for different reasons.

**Acquiring the data is a compliance problem, not a scraping problem.** County
inventory lives in ArcGIS services, spreadsheets, PDFs and pages behind bot
protection. The engineering question is not "can we get it" but "can we get it
lawfully, politely, and in a way that stays working" — and where the answer is
no, the system must degrade to a human workflow instead of finding a way around.

**Evaluating the data is an epistemics problem.** Almost every field is
uncertain, and the failure mode that loses money is not a missing value — it is
a *confidently wrong* one. A parcel whose headline economics look spectacular
because half its inputs were guessed is worse than no parcel at all.

**Deciding is a human problem.** Software can rank, screen and reject. It cannot
determine legal access, title status or buildability, and it must never transact.

The architecture follows from those three.

## Layering

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web            analyst terminal + public listings      │
│  apps/worker         queue consumer, scheduler               │
├─────────────────────────────────────────────────────────────┤
│  core/services       orchestration: enrich, value, score,    │
│                      memo, listing, alerts, discovery        │
├─────────────────────────────────────────────────────────────┤
│  pure engines        gis · core · valuation · title-research │
│                      · listing-engine     (no I/O, testable) │
├─────────────────────────────────────────────────────────────┤
│  ingestion           HTTP client, adapters, pipeline,        │
│                      enrichment connectors, manual import    │
├─────────────────────────────────────────────────────────────┤
│  db                  Prisma + the single PostGIS module      │
├─────────────────────────────────────────────────────────────┤
│  shared              enums, confidence, money, contracts     │
└─────────────────────────────────────────────────────────────┘
```

The pure engine layer performs no I/O. `assessAccess`, `assessBuildability`,
`scoreParcel`, `valueParcel` and `preScreenTitle` are functions from data to
data, which is why they can be exhaustively unit-tested and why the same code
runs in the worker and the web app with no possibility of divergence.

## The confidence model

Every derived field carries a level: `VERIFIED · HIGH · MEDIUM · LOW · UNKNOWN`.

Three rules make it mean something:

1. **Weakest link.** A value derived from several inputs is at most as confident
   as its least confident input.
2. **Extraction ceilings.** A method cannot exceed what it can support. A
   structured government API can assert VERIFIED; a regex over PDF text cannot,
   however confident the parser feels. AI extraction tops out at MEDIUM — the
   mechanical expression of "AI is never the sole authority".
3. **Unknowns score zero, they are not skipped.** A parcel with five great facts
   and five missing ones lands in the middle, not at the top.

The UI renders unknown values as dotted-underlined placeholders, never as a dash
or a zero, because the failure this product cannot afford is an analyst reading
"no wetlands" where the truth is "we never checked".

## Provenance

Every meaningful derived field writes an `Evidence` row: field, value, source,
URL, document key, extracted text, retrieval date, confidence, extraction
method. Evidence is append-only per (parcel, field) — a later observation does
not erase an earlier one, because "the county said $3,140 in March and $2,100 in
July" is exactly the history this product exists to notice.

Raw source artefacts are retained too. Provenance means keeping *the bytes we
actually parsed*, not a URL that may 404 next week.

## Why rejection is architectural

The scarce resource is analyst attention, not inventory. So rejection is a
distinct mechanism, not a low score:

- Hard rules run **before** scoring and produce a binary reject with a named,
  explainable reason.
- Rejected parcels leave the funnel and are excluded from every default query by
  a partial index.
- Overrides require a written reason, are audited, and are honoured only for
  rules marked overridable.

A landlocked roadway remnant priced at $400 must not be able to score 71 because
its discount is enormous. That is the whole design.

## The moat

Four tables exist solely to accumulate history that is not useful yet:
`ParcelChange`, `AuctionOutcome`, `ParcelScoreSnapshot`,
`ParcelValuationSnapshot`. They record price cuts, reappearances, failed sale
counts, auction results, acquisition prices, realised returns — and each score is
stamped with the immutable scoring-config version that produced it, so scores
remain comparable across time.

The question they are being collected to answer is:

> Which specific government disposal mechanisms, counties, parcel characteristics
> and acquisition stages consistently produce abnormal returns?

Nothing answers it today. It becomes answerable only if the history exists from
day one, which is why it is being written from day one.
