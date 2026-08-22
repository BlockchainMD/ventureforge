# Land Alpha

Land Alpha finds vacant land that is hard to discover or hard to evaluate — failed tax
auctions, over-the-counter forfeited inventory, statutory "lands available" lists,
government surplus — converts fragmented public records into structured parcel
intelligence, and ranks what is left by expected return after access, buildability,
title, environmental and liquidity risk.

The thesis is narrow and specific:

> Inventory that has already failed to sell, in jurisdictions where failure rolls into
> standing buy-it-now stock, is inventory nobody is competing for. Mispricing there
> persists instead of being arbitraged away.

The optimisation target is **not** parcels collected. It is *actionable mispriced parcels
surfaced per hour of analyst attention*. The system is built to reject aggressively: ten
exceptional candidates are worth more than a hundred thousand unranked rows.

---

## What works today

- **Three live government sources**, verified against their production endpoints:
  - **MN — St. Louis County tax-forfeited land** (~14,200 parcels with polygons, legal
    descriptions and assessed values)
  - **FL — Orange County Comptroller Lands Available for Taxes** (statutory §197.502(7)
    inventory, distinguished from scheduled tax deed sales)
  - **MI — Ottawa County treasurer / land-bank held parcels** (Act 123 inventory with
    property classes, values, acreage and geometry)
- **PostGIS-backed geometry** with acreage measured on the `geography` type, independently
  cross-checked against each county's own figure
- **Deterministic underwriting engines**: shape analysis, access, environmental screening,
  buildability, comparable-sales valuation, opportunity economics, Alpha Score
- **An analyst terminal**: dashboard, filterable opportunity table, parcel underwriting
  page, map, deal rooms, portfolio, leads, source health, ingestion observability and a
  versioned scoring model editor
- **AI investment memos and a listing factory** that cannot assert claims the data does not
  support, with a deterministic mode that needs no API key
- **Public property pages** generated from verified public records, with internal
  underwriting structurally unable to leak into them
- **147 tests**, including thirteen fixture archetypes whose expected pipeline conclusions
  are asserted against a real database

---

## Quick start

### Just run it (Docker only)

No Node, no pnpm — the whole product, built and served:

```bash
cd land-alpha
docker compose --profile app up --build     # http://localhost:3000
```

That starts Postgres/PostGIS, applies migrations, seeds the demo data and serves a
production build. First build takes a few minutes; subsequent ones are cached.

Sign in with `analyst@landalpha.local` / `landalpha-dev`.

A fresh stack contains fixture parcels only, so every score reads `unknown` until the
pipeline has run against real sources:

```bash
docker compose run --rm seed pnpm ingest      # pull county inventory
docker compose run --rm seed pnpm pipeline    # enrich, value, score
```

Stop with `docker compose --profile app down`, or `down -v` to discard the database.

### Develop against the source

Requires Node 22+, pnpm 10+, and Docker (or a local PostgreSQL 14+ with PostGIS).

```bash
cd land-alpha
cp .env.example .env

docker compose up -d postgres     # or point DATABASE_URL at your own Postgres
pnpm install
pnpm setup                        # generate client, run migrations, seed
pnpm dev                          # http://localhost:3000
```

Seeded accounts: `admin@landalpha.local` (ADMIN), `analyst@landalpha.local` (ANALYST),
`viewer@landalpha.local` (VIEWER) — all with password `landalpha-dev`.

To pull real inventory and run it through the pipeline:

```bash
pnpm ingest                                        # list registered sources
pnpm ingest mn-st-louis-tax-forfeited --limit 250  # real St. Louis County data
pnpm pipeline                                      # enrich → value → score
```

Or run the worker, which does all of that continuously:

```bash
pnpm worker
```

### Everything is optional except Postgres

The product runs with **no API keys**. AI defaults to a deterministic provider,
environmental enrichment defaults to fixture mode, the job queue defaults to Postgres, and
object storage defaults to the filesystem. `/settings` shows exactly how each integration
is currently resolving, so it is always obvious whether a figure came from FEMA or from a
fixture.

---

## Architecture

```
land-alpha/
├── apps/
│   ├── web/                Next.js 16 analyst terminal + public property pages
│   └── worker/             queue consumer: ingest → enrich → value → score → alert
├── packages/
│   ├── shared/             canonical enums, confidence model, money, filters, contracts
│   ├── db/                 Prisma schema, migrations, PostGIS layer, seed
│   ├── gis/                shape analysis, Esri→GeoJSON, projection handling
│   ├── core/               access, environmental, buildability, scoring + services
│   ├── valuation/          acreage curve, comps engine, Retail/QSV/ILV, economics
│   ├── ingestion/          HTTP client, adapters, pipeline, manual import, enrichment
│   ├── ai/                 provider abstraction, investment memos
│   ├── listing-engine/     marketing package generation with claim guardrails
│   ├── source-registry/    the County Opportunity Registry
│   └── title-research/     title pre-screen and human research queue
├── docs/decisions/         architecture decision records
└── infra/                  Docker Compose init, worker image
```

Everything runs on TypeScript. Both the web app and the worker import the *same* domain
packages, so the Alpha Score computed during ingestion and the one rendered in the UI
cannot diverge — see [ADR 0002](docs/decisions/0002-typescript-only-runtime.md).

### Data flow

```
County endpoint
  → SourceAdapter        discover → fetch → parse → normalize → validate
  → ParcelOpportunity    idempotent upsert on a natural key, with change detection
  → Enrichment           geometry metrics, road adjacency, FEMA/NWI/EPA/USGS overlays
  → Valuation            comparable sales → Retail / Quick Sale / Investor Liquidation
  → Economics            all-in basis, basis/QSV, ROI
  → Alpha Score          weighted components, hard rejection rules
  → Analyst              ranked, filtered, underwritten, decided by a human
```

---

## Database

PostgreSQL 14+ with PostGIS. Prisma owns the schema and migrations; all spatial work goes
through one audited module, `packages/db/src/spatial.ts`.

```bash
pnpm db:migrate       # apply migrations
pnpm db:seed          # users, scoring config, comps, 33 fixture parcels
pnpm db:studio        # browse
pnpm db:reset         # drop and rebuild (destructive)
```

Two things about the spatial layer are load-bearing:

1. **Every measurement is taken on the `geography` type.** `ST_Area(geom)` on an EPSG:4326
   geometry returns square *degrees* — a meaningless number that silently becomes a wrong
   acreage. `ST_Area(geom::geography)` returns square metres. This is the single most
   common way a GIS pipeline produces confidently wrong land measurements.
2. **Ids are `text`, not `uuid`.** Prisma maps `String @id @default(uuid())` to a text
   column, so a `::uuid` cast in raw SQL fails at runtime. All parameters bind as text.

---

## Ingestion

### How it works

Adapters implement five separable stages:

| Stage | Responsibility |
|---|---|
| `discover()` | locate the current artefact — list URLs change every quarter |
| `fetch()` | pull bytes, retained verbatim for provenance |
| `parse()` | bytes → raw records, **no interpretation** |
| `normalize()` | raw records → `ParcelOpportunityInput`, **all interpretation** |
| `validate()` | reject records that would poison the pipeline |

Parse and normalize are separate on purpose: a county changing a *column header* breaks
parse, a county changing what a column *means* breaks normalize, and conflating them makes
both failures look identical in the logs.

Ingestion is idempotent — identity is `(sourceId, sourceRecordId ?? normalised APN)` — and
honest about partial failure. A run that parses 4,000 of 4,003 rows is `PARTIAL` with
three named rejections, never a silent success.

### Access posture

The ingestion HTTP client identifies itself, evaluates `robots.txt` per host, rate-limits
with a per-host token bucket, honours `Retry-After`, caps requests per run, and detects
bot-challenge pages served with HTTP 200 rather than parsing the interstitial as data.

It has **no capability** to solve a CAPTCHA, authenticate against a protected system, or
evade a technical access control. A source requiring any of those is registered
`MANUAL_SOURCE` and routed to the analyst import workflow, where it becomes exactly the
same `ParcelOpportunity` record with the same provenance.

This is a product decision, not a limitation to work around. The Ottawa County treasurer
list serves a CAPTCHA interstitial and is registered `MANUAL_ONLY` with the finding written
down, so no future engineer re-investigates it.

### Adding a source

Most counties need **no code**. Add an entry to
`packages/source-registry/src/registry.ts`:

```ts
{
  key: 'mn-itasca-tax-forfeited',
  state: 'MN',
  county: 'Itasca',
  fipsCode: '27061',
  name: 'Itasca County Tax-Forfeited Land',
  sourceType: 'TAX_FORFEITED',
  sourceUrl: 'https://…/MapServer/7',
  ingestionMethod: 'ARCGIS_REST',
  adapterKey: 'arcgis-parcel-inventory',    // an existing adapter
  failedAuctionBecomesOtc: true,
  dispositionNotes: 'How this county actually disposes of failed inventory…',
  config: {
    layerUrl: 'https://…/MapServer/7',
    where: "Ownership = 'Tax Forfeit'",
    fieldMap: { apn: 'PRCL_NBR', acreage: 'ACREAGE', /* … */ },
  },
}
```

Then `pnpm ingest mn-itasca-tax-forfeited --limit 50` to verify before enabling it.

A genuinely new *shape* of source needs an adapter: implement `SourceAdapter`, register it
in `packages/ingestion/src/adapters/index.ts`, and reference its key from the registry.

The registry is the strategic asset. It records not just where data is but **how each
jurisdiction disposes of land nobody bought** — and `failedAuctionBecomesOtc` is the single
attribute that most predicts whether mispricing persists in a county.

---

## GIS

Parcel geometry is normalised into EPSG:4326 GeoJSON at the boundary, then measured in
PostGIS. Three defects are handled explicitly because they are the ones that actually
occur:

- **Esri ring winding.** Esri encodes outer rings clockwise and holes counter-clockwise;
  GeoJSON specifies the opposite. A naive conversion treats holes as separate outer rings
  and inflates measured area.
- **Transposed coordinates.** Latitude/longitude swaps are detected and repaired, and the
  repair is reported rather than applied silently.
- **Unknown projections.** A state-plane coordinate is **rejected**, not approximated.
  Mis-projecting a parcel by 30 km is far worse than declining to place it.

Shape analysis uses a **minimum-area oriented bounding box**, not the axis-aligned
envelope. A diagonal 8 m × 500 m road remnant has a nearly square axis-aligned bbox and
would otherwise score as a well-formed parcel — which is exactly the junk this system
exists to reject.

---

## Valuation

Deterministic and comps-driven. No consumer listing portals are scraped; inputs are
recorded sales from county deed and assessor files, state transfer datasets, and analyst
imports.

**The acreage curve.** Price per acre is not constant across parcel sizes, and averaging
raw $/acre is the most common way land valuations go wrong. Land Alpha models it as a
power law:

```
PPA(a) = PPA(a_ref) × (a_ref / a) ^ k        k ≈ 0.35
```

Beyond a 6× size ratio the extrapolation stops being credible and the comp is dropped
rather than stretched.

**A weighted median, not a mean.** County sale files contain $1 family transfers, estate
distributions and outright outliers. A mean chases them; a median does not.

**Three values, three questions.**

| Value | Question |
|---|---|
| Retail | what a patient seller reaches with full marketing exposure |
| **Quick Sale (QSV)** | what is achievable when priced to move — **what we underwrite against** |
| Investor Liquidation | what another informed land investor pays tomorrow |

Underwriting against QSV rather than retail is the core conservatism: the thesis must
survive the assumption that we sell in a hurry, because failed government inventory is
exactly the kind of asset one ends up needing to move.

When there are no usable comps, the engine says so and returns nothing. It does not invent
a number.

**Where the comps come from.** `pnpm comps` ingests recorded sales from county assessor
sales layers. Each row must carry the county's *own* vacant/improved and qualified-sale
determinations — inferring "this looks like vacant land" from the price would be circular,
because the price is the thing being explained. Rows that clear those two gates then pass a
validator that rejects nominal transfers below $1,000, impossible acreages, future dates,
and prices per acre outside $100–$500,000.

| Source | Status | |
|---|---|---|
| Marion County, FL — state roll | `ACTIVE` | 4,883 sales · median $68,138/ac |
| Citrus County, FL — state roll | `ACTIVE` | 3,189 sales · median $58,065/ac |
| Orange County, FL — state roll | `ACTIVE` | 655 sales · median $171,410/ac |
| Grant County, MN — assessor sales layer | `ACTIVE` | 181 sales · median $7,159/ac |
| Polk / Lake / Volusia / Osceola, FL | `ACTIVE` | Registered, not enabled — each import pulls tens of MB from a public server |
| St. Louis County, MN — sales comp finder | `TOKEN_REQUIRED` | HTTP 499 to anonymous requests; not worked around |
| Ottawa County, MI · Mille Lacs County, MN | `UNAVAILABLE` | Parcel services publish no sale fields |

Florida publishes the same NAL (property roll) and SDF (sale data) files for all
67 counties, so a county is one line of configuration. Neither file is a
comparable alone — the SDF knows a sale happened and whether the appraiser
qualified it, only the NAL knows how big the parcel is — so the importer joins
them and gates on four independent facts, including the roll's own building
count. That last gate vetoed 185 of Orange County's 845 appraiser-marked-vacant
rows. See [`docs/decisions/0009`](docs/decisions/0009-florida-tax-roll-importer.md).

For counties that publish a sales file but no API, `importComparablesCsv` takes an analyst
export. It requires vacant and qualified columns, or an explicit assertion that the file is
already filtered. It never assumes.

Synthetic and recorded sales never mix. A fixture parcel is valued only against
fixture comparables and a real parcel only against recorded sales — a fixture
whose expected conclusion tracks the Orlando land market is not a specification.
Fixture-backed valuations are capped at `LOW` confidence, carry a
do-not-underwrite warning, and are flagged in red on the parcel page.

Florida valuations are also capped at `LOW`, for a different reason: the state
roll carries no coordinates, and plenty of agreeing sales is not the same as
plenty of nearby ones. Geolocating them is the highest-value open item.

---

## Deciding, not just describing

Valuation says what a parcel is worth. These decide what to do about it.

**Time to exit.** Return is annualised, so hold time is half the answer. Every
parcel used to assume 180 days, which meant two parcels with 1534% and 1507%
raw return ranked together while their annualised returns were 478% and 1804%.
A baseline hold is now adjusted by named factors — size, price band, access,
buildability, utilities, market depth — and class A access averages 202 days
against 876 for class D. Roll files record that a sale happened, not how long it
was listed, so this is a reasoned assumption rather than a measurement, and its
confidence is capped until realised hold times exist to correct it.

**Calibration.** `pnpm calibrate` grades predicted quick-sale value and hold
period against what parcels actually sold for and how long they took, per
market, and feeds corrections back. It grades the valuation in force *at
acquisition*, not today's — today's has the benefit of comparables recorded
after the purchase. It uses a median, refuses to correct below five closed sales
in a market, and bounds every correction. With no closed deals it says so
plainly rather than emitting factors.

**Cash or carry.** A $15,000 parcel sold outright returns $15,000; at 10% down
over 84 months it returns about $21,400 nominal and reaches a far wider pool of
buyers, but locks the capital up for seven years. The engine amortises in
integer cents, computes the IRR of the payment stream, and compares it against
the annualised return of a cash sale. The ledger stores payments and derives the
schedule, so a note cannot drift out of agreement with its own arithmetic.

**Capital allocation.** `/allocate` answers the question a ranked list cannot:
given $50,000, which *set* of parcels? Bounded knapsack on expected profit per
dollar per year, capped at 40% per county and 25% per parcel, with every
exclusion explained. It flags a pick implying more than 500% a year as more
likely a valuation error than an opportunity — it is the last place a bad
valuation can be caught before someone acts on it.

**Speed.** Alerts fire on the change log rather than on what is new, so a price
cut on a parcel you already know about is no longer silent. A cut of 25% or more
is immediate; a price *increase* is recorded and not alerted; anything on a
parcel selling within three days is immediate.

See [`docs/decisions/0010`](docs/decisions/0010-profitability-engines.md).

---

## Scoring methodology

The Alpha Score is 0–100, weighted (configurable at `/admin/scoring`):

| Weight | Component |
|---|---|
| 30% | discount of all-in basis to conservative quick-sale value |
| 20% | access |
| 15% | buildability |
| 10% | title simplicity |
| 10% | liquidity |
| 5% | carrying cost |
| 5% | shape and topography |
| 5% | unique desirability (failed auctions, stale inventory, OTC availability) |

Two commitments make it trustworthy:

**Rejection happens before scoring, not through it.** A landlocked roadway remnant must not
be able to score 71 because its price is low. Hard rules produce a binary reject with a
named reason:

`ROADWAY_REMNANT` · `NO_ACCESS_WITHOUT_EXCEPTIONAL_DISCOUNT` · `BASIS_EXCEEDS_QSV` ·
`SEVERE_TITLE_RISK` · `CONTAMINATED_SITE` · `PARCEL_TOO_SMALL` · `DUPLICATE_PARCEL` ·
`SUBMERGED_OR_FULL_WETLAND`

Most are overridable by an analyst with a written, audited reason. `DUPLICATE_PARCEL` is not.

**Unknowns are visible, not averaged away.** A component with no data scores neutrally
*and* drags the confidence score down, so an 87-with-LOW-confidence never masquerades as
an 87.

### Acquisition economics

```
Acquisition + Government fees + Recording + Title + Curative + Carrying + Marketing
  = All-in basis
```

Tiers, by basis ÷ QSV: **Exceptional** ≤ 10% · **Strong** ≤ 20% · **Potential** ≤ 30% ·
**Weak** > 30%. All configurable.

The recommended maximum bid is the arithmetic inverse of that standard — the highest price
at which the basis still lands inside the target ratio.

---

## What this software does not determine

Three things are never asserted by software here, and the codebase enforces it structurally
rather than by convention:

**Legal access.** `legalAccessStatus` starts `UNKNOWN` and only a human-reviewed recorded
instrument moves it. Physical adjacency is recorded separately as `physicalAccessScore` and
never renamed to "access". The A–D class describes *the strength of evidence for physical
access* and carries that caveat everywhere it appears.

**Title.** The pipeline produces a *pre-screen*, labelled as such wherever it appears, and
never a title opinion or commitment. Where a recorder cannot be searched programmatically,
a precise task is generated for a person rather than a guess.

**Buildability.** GREEN/YELLOW/RED is a *screening* conclusion that must enumerate its
evidence, its unknowns and its blocking issues. GREEN always renders with an asterisk and
its disclaimer.

**AI is never the sole authority** for title, access, buildability, zoning, environmental
condition or valuation. It may summarise and explain evidence; it may not originate a
number a deterministic engine could have computed. The listing factory enforces this
mechanically: facts are assembled deterministically first, unsupported claims are withheld
and recorded, and a model response asserting buildability or legal access is discarded.

**Land Alpha never transacts.** It never submits a bid, signs a purchase agreement, wires
funds, or accepts a government auction. Recording an approved maximum bid captures a
human's authorisation and stops there.

---

## AI architecture

Provider-agnostic, configured entirely by environment:

```
AI_PROVIDER=fixture|anthropic|openai
AI_MODEL_REASONING=…      AI_MODEL_FAST=…
```

Model names are never hard-coded in application logic.

`fixture` is the default and is not a stub. Because AI cannot be the sole authority for any
determination, every figure in a memo already comes from a deterministic engine — fixture
mode renders those same facts without the prose. Less pleasant to read, exactly as
trustworthy.

---

## Testing

```bash
pnpm test          # 147 tests
pnpm typecheck
pnpm lint
pnpm verify        # all three
pnpm smoke         # drive the real app in a browser (needs pnpm dev running)
pnpm audit:responsive   # check every route at a phone viewport (needs pnpm dev running)
pnpm calibrate     # grade past predictions against realised outcomes
pnpm comps --enrich-fl Orange   # fill parcel facts from the Florida roll
pnpm comps --geocode-fl Orange  # put the county's comparables on the map
```

**Importing comparables is two steps, and the second one is not optional.**
`pnpm comps <source>` loads the sales; `pnpm comps --geocode-fl <County>` gives them
coordinates from the statewide parcel-centroid layer. A sale with no coordinates cannot be
distance-filtered, so a county imported without the second step values every parcel off sales
that could be anywhere in it — and every valuation there comes back LOW, with the parcel page
saying so. Running it on Marion moved its two priced parcels from LOW to MEDIUM and HIGH.

Integration tests run against a real PostGIS database and **skip themselves** when none is
reachable, so `pnpm test` is green on a fresh clone.

`packages/db/src/seed/fixture-parcels.ts` is a *specification*, not sample data. Thirteen
archetypes each declare what the pipeline must conclude about them — excellent deal,
landlocked, roadway remnant, full wetland, floodplain, contaminated, too small, severe
title risk, overpriced, sparse-data — and the integration suite asserts every one. A change
to a rejection rule that breaks an archetype fails loudly, with the rule named.

---

## Deployment

### Google Cloud, one command

```bash
PROJECT_ID=your-project ADMIN_EMAIL=you@example.com ./infra/gcp/deploy.sh
```

Cloud Run in front of Cloud SQL for PostgreSQL: roughly ten minutes, roughly
$10/month, and a URL that works from a phone. The script is idempotent — re-run
it to ship a change. `./infra/gcp/teardown.sh` removes every billable resource,
and `./infra/gcp/connect.sh` opens an IAM-authenticated tunnel so a laptop or an
agent container can drive the hosted database directly.

Two things ship deliberately switched off. The deployment is **never seeded** —
`pnpm db:seed` publishes its passwords in this repository, so `pnpm
bootstrap:admin` creates a single administrator from Secret Manager instead, and
refuses to finish if any account still carries the development password. And the
unauthenticated listing site is off (`PUBLIC_SITE_ENABLED=false`) until you turn
it on.

Full runbook, cost breakdown and troubleshooting: [`infra/gcp/README.md`](infra/gcp/README.md).
Reasoning: [ADR 0016](docs/decisions/0016-hosting-on-cloud-run-and-cloud-sql.md).

### Anywhere else

**Web** — the root `Dockerfile` builds a self-contained image (Next standalone output,
~630MB) that runs anywhere containers do: Cloud Run, Fly, ECS, a VM. Or Vercel, or any
Node host. Set `DATABASE_URL`, `AUTH_SECRET`, and whichever integrations you are enabling.

**Migrations** — run as their own step, not on instance start. The `build` stage image
carries the full workspace:

```bash
docker run --rm -e DATABASE_URL=... land-alpha-seed pnpm db:migrate
```

**Building behind a TLS-inspecting proxy** — pass the proxy's CA and it is trusted for the
install layer only, never copied into an image:

```bash
docker build --secret id=ca_bundle,src=/path/to/ca.crt -t land-alpha-web .
```

**Worker** — a separate container (`infra/Dockerfile.worker`). Its workload is long-running
and scales differently from request traffic.

**Database** — any managed PostgreSQL with PostGIS (RDS, Cloud SQL, Neon, Supabase).

**Queue** — set `REDIS_URL` to switch from the Postgres-backed queue to BullMQ for
horizontal workers. Job history stays in Postgres either way, so the ingestion screens work
identically under both drivers.

**Storage** — set `STORAGE_DRIVER=s3` with any S3-compatible endpoint.

Production requires `AUTH_SECRET`; the environment validator refuses to boot without it.

---

## Using it from a phone

The terminal is built for a wide screen — dense tables, tabular figures, a
persistent nav rail — and that is the right shape for underwriting. It is not
the right shape for a 390px screen, so below `lg` the rail becomes a drawer,
metric strips step down from six columns to four and then two, the opportunity
filter bar collapses behind a `Filters (n)` disclosure, and action rows wrap
instead of running off the edge.

Wide comparison tables still scroll horizontally rather than reflowing. That is
deliberate: a row of figures is meaningful because it lines up with the row
above it, and stacking each parcel into a card would destroy the comparison the
table exists to make.

`pnpm audit:responsive` walks every route at a phone viewport and fails on
anything that spills past it without being reachable — content inside a
horizontal scroller passes, and so does `truncate`'s ellipsis; a clipped button
does not.

The app declares a web manifest and icons, so it can be added to a home screen
and opened without browser chrome.

---

## Roadmap

**Near term**
- FL DOR NAL/SDF importer — one format covering all 67 Florida counties, including the
  ones we already ingest inventory from; the shortest path to real comps on real parcels
- More county assessor sales layers, extending the `arcgis-assessor-sales` adapter
- More Minnesota counties (Crow Wing, Mille Lacs, Aitkin — already registered as candidates)
- Marion County FL Lands Available PDF adapter
- Recorder integrations where terms permit, feeding the title pre-screen real instruments

**Then**
- Washington tax-title land, Ohio forfeited land, state DOT/DNR surplus, land banks
- Raster DEM processing for real slope and aspect, replacing point-sampled terrain
- Parcel photography and imagery review in the deal room

**The long game**

Every outcome is recorded from day one — price changes, reappearances, failed sale counts,
auction results, acquisition prices, time to sale, realised returns, jurisdiction-specific
title problems. `ParcelChange`, `AuctionOutcome`, `ParcelScoreSnapshot` and
`ParcelValuationSnapshot` exist to answer one question once there is enough history:

> Which specific government disposal mechanisms, counties, parcel characteristics and
> acquisition stages consistently produce abnormal returns?

Scoring configurations are immutable and versioned precisely so that a score from March
remains comparable to one from July. That is what makes the question answerable at all.

---

## Compliance principles

1. Use publicly available and lawfully accessible information
2. Respect rate limits and access restrictions
3. Never bypass CAPTCHAs or authentication controls
4. Preserve source attribution
5. Distinguish automated title research from professional title work
6. Distinguish buildability screening from government approval
7. Make no unsupported claims in property advertising
8. Require human authorisation for binding acquisitions
9. Allow jurisdiction-specific legal review
10. Maintain complete audit history

See [ADR 0006](docs/decisions/0006-legal-and-compliance-posture.md) for how each is
implemented.

---

## Disclaimers

Land Alpha produces **screening conclusions**, not professional determinations. It is not a
title company, a surveyor, an appraiser, an environmental consultant, or a land-use
authority. Nothing it outputs is a title opinion, a title insurance commitment, an
appraisal, a zoning determination, a permit, a septic approval, a survey, or a Phase I
Environmental Site Assessment.

Verify everything with the relevant authority and licensed professionals before acquiring
land.
