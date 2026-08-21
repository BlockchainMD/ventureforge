# 0009 — The Florida tax roll, and keeping synthetic data out of real valuations

Status: accepted · 2026-08-21

## Context

[ADR 0008](0008-comparable-sales-sourcing.md) closed with a gap it could not
close: the one county with public comparable sales, Grant County MN, has no
tax-forfeited inventory, so every parcel in the database was valued off
development fixtures and reported `LOW` confidence with a do-not-underwrite
warning. Nothing was underwritable.

Florida is the way out. The Department of Revenue publishes three assessment
rolls per county per year in one statewide format, on a schedule set by statute:
preliminary in July, initial final in October, final after value-adjustment-board
certification. Two of them matter:

- **NAL** (Name-Address-Legal) — one row per parcel: land area, DOR use code,
  land and just values, building count, living area.
- **SDF** (Sale Data File) — one row per recorded transfer: price, year and
  month, the appraiser's vacant/improved determination, the appraiser's sale
  qualification code, and a multi-parcel flag.

Neither is a comparable on its own. The SDF knows a sale happened and whether
the appraiser qualified it; only the NAL knows how big the parcel is, and a
price without an area cannot produce a price per acre.

## Decision

### Join the two rolls, and gate on four independent facts

A transfer becomes a comparable only if all four hold:

1. `SDF.VI_CD = 'V'` — the appraiser says the parcel was vacant at sale
2. `SDF.QUAL_CD` is a configured qualified code — the appraiser says market-rate
3. `SDF.MULTI_PAR_SAL` is empty — the price covers this parcel and no other
4. `NAL.NO_BULDNG = 0` and `NAL.TOT_LVG_AREA = 0` — the roll independently agrees

The fourth gate is not redundant. Against Orange County's 2026 preliminary roll
it vetoed **185 of 845** rows the SDF had marked vacant, because the parcel
carries a building on the assessment roll. Each would have been an
improved-property sale inflating a land valuation. When two county records
disagree about whether a sale included a house, the safe reading is that it did.

### Accept one qualification code, not a guessed forty

PTO does not publish the field dictionary in the data library — the only user
guide there covers navigating the SharePoint folders. Rather than assume a
meaning for forty codes, the importer accepts `01` and nothing else by default.
In Orange County's file that code covers 28,835 sales at a median of $430,000,
while the next most common codes (`11`, `14`, `19`) sit at a median of $100 and
are plainly nominal conveyances. Widening the set is a configuration change to
be made against the authority, not a guess made in the adapter.

### Stream the roll rather than hold it

Orange County's NAL is 35MB compressed and 266MB expanded, and there are 67
counties. The SDF is read first to learn which parcels are interesting; the NAL
is then inflated and parsed as a stream, keeping only rows whose parcel appeared
in the qualified-sale set — 806 rows out of 493,489.

### Fill inventory facts from the same roll

Fifty-five of Orange County's sixty-four listed parcels arrived from the
Comptroller with no acreage, and a parcel with no area cannot be valued at all.
The roll's parcel id is the county's parcel id with the punctuation removed
(`24-24-28-5844-00-310` and `242428584400310` are the same parcel), and **all
fifty-five matched**. Acreage, land value and just value are filled where the
parcel has none — never overwritten, because the county list is the authority on
what is for sale and the roll is the authority on what the parcel is.

### Reject parcels the roll says are improved

The enrichment found **20 listed "vacant land" parcels carrying a building**. A
structure on a tax-forfeited parcel is a liability, not a bonus: it carries
demolition cost, code-enforcement exposure and often an occupant, none of which
is priced by a vacant-land comparable. New rejection rule
`IMPROVEMENTS_PRESENT`, overridable — a demolition play is a real strategy, but
it must be an analyst's decision rather than one the pipeline makes silently.

### Recalibrate the price-per-acre ceiling

The old validator rejected anything above $500,000 per acre as a data error.
That was calibrated on rural Minnesota, where the median qualified vacant sale
is $7,159 per acre. Orange County's median is $171,410 and its ninetieth
percentile is $1.6m. Price per acre is a ratio, so a small parcel reaches an
enormous one honestly — a $250,000 eighth-of-an-acre infill lot in Orlando is
$2m per acre and a perfectly real sale. The ceiling moved to $20m per acre,
which no land sale can produce, plus a $25m absolute cap because a transaction
that size is a different market. Size comparability is enforced by the acreage
band and the acreage curve, which is the right place for it.

### Keep the synthetic and recorded worlds apart

Once real Orange County comparables existed, a fixture parcel in the same county
started drawing on them — and a fixture whose expected conclusion depends on the
Orlando land market is no longer a specification, it is a market tracker. One
fixture stopped being rejected because real comps valued it too highly.

So the two worlds are now closed to each other: a parcel whose APN carries the
`FX-` prefix is valued **only** against fixture comparables, and every real
parcel **only** against recorded sales. This also makes the existing
fixture-confidence cap coherent — a real valuation can no longer be
contaminated, and a fixture valuation is honestly labelled.

### Cap confidence when no comparable can be placed

The roll carries no coordinates, so Florida comparables have no centroid. The
confidence ladder previously fell through to `MEDIUM` even with zero geolocated
comps; it now returns `LOW`. In a county spanning a city and its farmland that
is the difference between a $2m-per-acre infill lot and a $20k-per-acre field,
and plenty of agreeing sales is not the same as plenty of nearby ones.

## Results

| | before | after |
|---|---|---|
| Orange County FL comparables | <20 (public ArcGIS layer) | **655** |
| FL parcels with a valuation | 9 of 64 | **64 of 64** |
| FL parcels valued off recorded sales | 0 | **55** |
| FL parcels with known acreage | 9 | **64** |
| Improved parcels caught | 0 | **20** |

Every Florida valuation still reports `LOW` confidence, because the roll cannot
be geolocated. That is the honest ceiling for this source as it stands, and it
is now the only thing between Florida and an underwritable number.

## Consequences

- The importer takes any of Florida's 67 counties as one line of configuration.
  Coverage is a research question about inventory, not an engineering one.
- Geolocating the comparables is the single highest-value follow-up: DOR
  publishes per-county parcel shapefiles in the same library (`orange_2023pin.zip`,
  257MB), which would join on the same parcel id and lift Florida confidence off
  its floor. It needs a shapefile reader, which the project does not yet have.
- The county's own ArcGIS parcel layer is not a substitute: it covers
  unincorporated Orange County only, and matched none of a 60-parcel sample.
- Sale dates carry month precision only. The SDF records a year and a month and
  no day, so every Florida comparable is dated to the first of its month.
