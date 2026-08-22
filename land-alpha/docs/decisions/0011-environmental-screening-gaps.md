# 0011 — Environmental screening layers that cannot be automated

Status: accepted · 2026-08-22

## Context

Every parcel in inventory carried empty environmental data. The wetland and
contamination rejection rules had never fired once, on any parcel, in the
project's history. That was read as "our inventory happens to be clean". It was
not.

Probing each layer with the real ingestion client produced three distinct
findings, none of them a transient outage:

| Layer | Source | Result |
| --- | --- | --- |
| Flood | `hazards.fema.gov/arcgis/.../NFHL` | `robots.txt` contains `Disallow: /arcgis` and `Disallow: /*?*` |
| Wetlands | `fwspublicservices.wim.usgs.gov/wetlandsmapservice` | WAF returns an HTML block page ("Attack ID: 20000051") for our User-Agent |
| Contamination | `data.epa.gov/efservice` | FRS tables no longer expose `latitude83`/`longitude83`, and range filters are silently ignored |
| Soils | — | no adapter was ever written |
| Terrain | `epqs.nationalmap.gov` | works |

The NFHL is not published on any FEMA host that permits automated access:
`gis.fema.gov` allows `/`, but does not serve NFHL; `msc.fema.gov` disallows
both `/arcgis` and every query-string URL, which is the form its downloads take.
The EPA's coordinate-bearing FRS service on `geopub.epa.gov` disallows
`/arcgis/` outright.

The EPA finding is the worst of the three. Dropping the `frs.` schema prefix
makes the query return HTTP 200 — with Massachusetts facilities for a Duluth
bounding box, and `latitude83: null` on every row. A source that answers
confidently with the wrong rows is more dangerous than one that fails.

## Decision

**We do not work around any of them.** Not the robots directives, not the WAF,
not by finding a third-party mirror of FEMA's data to sidestep FEMA's stated
preference. These layers are `MANUAL_SOURCE`: an analyst screens the parcel in
the public map viewer before a bid, exactly as with the county inventories that
sit behind bot protection.

The contamination adapter no longer contains a query. It returns
`available: false` with the reason and the manual-screen URL. A plausible
adapter pointed at an endpoint that returns the wrong rows would look like
progress while defeating every protection below.

## What changed in the code

The real defect was never the unreachable services — it was that the pipeline
could not tell the difference between *clear* and *unchecked*, and rendered both
as blank.

1. `EnvironmentalAssessment.layersScreened` records which layers actually
   answered. Persisted as `ParcelOpportunity.environmentalLayersScreened`.
2. `EnvironmentalAssessment.unknowns` is persisted as
   `environmentalUnknowns`. It was computed correctly all along and discarded at
   the database boundary.
3. Each unknown names its cause. `describeUnavailable` distinguishes an
   `AccessRestrictedError` — permanent, needs a person — from a timeout, and
   appends the URL where a person can do it.
4. **Terrain alone is no longer a screening.** If none of flood, wetlands or
   contamination answered, environmental confidence is `UNKNOWN`, not `LOW`.
   `assessBuildability` already collapses to `UNKNOWN` when environmental
   confidence is `UNKNOWN`, so this one rule stops the pipeline rating a parcel
   GREEN on the strength of an elevation query.
5. The memo generator gates each claim of absence on the corresponding layer
   appearing in `layersScreened`. It had been emitting "No regulated cleanup
   site identified within the search radius" for parcels where no search radius
   existed and no search was run.
6. The parcel page prints `not screened` where it used to print an empty cell,
   and lists the environmental unknowns beneath the metrics.

## Consequence

Parcels whose only environmental data is slope now read `UNKNOWN` and screen as
buildability `UNKNOWN` rather than YELLOW or GREEN. That is a downgrade of the
apparent quality of current inventory and an accurate one: those parcels have
not been screened. The rating returns as soon as an analyst records a manual
screen through the import workflow, or when a permitted automated source for any
hazard layer is found.
