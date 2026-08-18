# ADR 0006 — Access posture, and the fact/inference boundary

- Status: Accepted
- Date: 2026-08-18

## Context

Land Alpha ingests government records and produces conclusions that a human
will risk real money on. Two failure modes are unacceptable: unlawful or
abusive collection, and automated output that reads like a professional
determination it is not.

## Decision — collection

Adapters obtain data in this preference order: official API → ArcGIS REST
service → CSV/XLS export → structured HTML → PDF. The ingestion HTTP client
(`packages/ingestion/src/fetch/http.ts`) enforces:

- a descriptive `User-Agent` identifying the crawler and a contact address
  (`INGEST_USER_AGENT`),
- per-host `robots.txt` evaluation, cached per run,
- a per-host token-bucket rate limiter with configurable delay,
- honouring `Retry-After` and backing off on 429/5xx,
- a hard cap on request volume per ingestion run.

The client has **no** capability to solve CAPTCHAs, authenticate against
protected systems, or evade a technical access control. A source that requires
any of those is registered as `MANUAL_SOURCE` and routed to the analyst import
workflow instead. This is a product decision, not a limitation to work around.

## Decision — the fact/inference boundary

Three things are never asserted by software in this system:

1. **Legal access.** `legalAccessStatus` starts at `UNKNOWN` and only a
   human-reviewed recorded instrument moves it. Physical adjacency to a road is
   recorded separately as `physicalAccessScore` and never renamed to "access".
2. **Title.** The pipeline produces a *pre-screen*, labelled as such everywhere
   it appears, and never a title opinion or commitment.
3. **Buildability.** GREEN/YELLOW/RED is a *screening* conclusion that must
   enumerate its evidence, its unknowns and its blocking issues. GREEN is
   always rendered with an asterisk and its disclaimer.

Every derived field carries `source`, `retrievedAt`, `confidence` and an
`Evidence` row. AI may summarise and explain evidence; it may not be the sole
authority for title, access, buildability, zoning, environmental condition or
valuation, and it may not originate a number that a deterministic engine could
have computed.

## Consequences

- Some counties will never be automated. That is the correct outcome.
- The UI must show uncertainty prominently; see the confidence model in
  `packages/shared/src/confidence.ts`.
