# ADR 0002 — One language for the domain model: TypeScript

- Status: Accepted
- Date: 2026-08-18

## Context

The build brief allows a standalone Python/FastAPI service for long-running
ingestion and analysis, or a Node worker with Redis/BullMQ. Both are viable.

## Decision

**Everything runs on TypeScript/Node 22.** `apps/web` (Next.js) and
`apps/worker` (queue consumer) both import the *same* domain packages:
`core`, `gis`, `valuation`, `ingestion`, `title-research`, `listing-engine`.

## Rationale

The single largest correctness risk in this system is **model drift** — an
`AlphaScore` computed one way in the ingestion worker and another way in the UI,
or a `ParcelOpportunity` normalized differently by two parsers. A Python worker
would force a second implementation of the canonical model, the scoring weights,
the rejection rules and the economics formulas, or an RPC boundary around them.

Heavy spatial work is not done in application code anyway — it is pushed into
**PostGIS**, which is where it belongs and is language neutral. Vector geometry
math that stays in-process uses `@turf/turf`, which is a faithful port of the
same JTS/GEOS lineage.

Python is *not* forbidden long-term. When a genuine numerical/ML workload
appears (hedonic valuation models, raster DEM processing, parcel matching),
it will be added as a separate service behind an HTTP interface that consumes
the canonical JSON contracts in `@land-alpha/shared` — never as a second copy
of the domain model.

## Consequences

- One set of unit tests governs scoring and valuation for every consumer.
- Raster/ML work is deferred until it justifies a second runtime.
