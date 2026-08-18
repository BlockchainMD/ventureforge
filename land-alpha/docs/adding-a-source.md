# Adding a source

Most counties need no code at all.

## 1. Research the jurisdiction first

Before writing anything, answer these — they go in the registry entry and become
the jurisdiction intelligence shown on the source page:

- How does this county dispose of land that fails at auction?
- **Does failed inventory roll into standing over-the-counter stock?** This is
  the single most predictive attribute for the Land Alpha thesis.
- What is the actual acquisition mechanism — auction, sealed bid, application,
  first come first served?
- Is there a waiting period, a priority window, or a statutory price?
- Where is the inventory published, and in what format?

## 2. Check how the data is reachable

In preference order:

1. Official API
2. ArcGIS REST service
3. CSV / XLSX export
4. Structured HTML
5. PDF
6. Manual import

For an ArcGIS service, inspect it before writing anything:

```bash
curl -s "https://…/MapServer/7?f=json" | jq '{name, geometryType, maxRecordCount}'
curl -s "https://…/MapServer/7?f=json" | jq '[.fields[].name]'
curl -sG "https://…/MapServer/7/query" \
  --data-urlencode "where=1=1" --data-urlencode "outFields=Ownership" \
  --data-urlencode "returnDistinctValues=true" --data-urlencode "returnGeometry=false" \
  --data-urlencode "f=json"
```

The last one usually reveals the `where` clause that isolates government-held
inventory — `Ownership = 'Tax Forfeit'` in St. Louis County MN, an owner-name
pattern in Ottawa County MI.

**If the host serves a CAPTCHA, requires a login, or disallows the path in
`robots.txt`, stop.** Register it as `MANUAL_SOURCE` with a note recording what
you found, so nobody re-investigates it. That is a correct outcome.

## 3. Add the registry entry

`packages/source-registry/src/registry.ts`. Set `status: 'CANDIDATE'` and
`enabled: false` until you have verified it.

## 4. Verify against the live endpoint

```bash
pnpm ingest <your-key> --limit 25
```

Check the run's warnings and rejections, then inspect what landed:

```sql
SELECT apn, acreage, "landAssessedValue", left("legalDescription", 60)
FROM "ParcelOpportunity" WHERE "sourceId" = '…' LIMIT 10;

-- Does PostGIS agree with the county's own acreage figure?
SELECT apn, acreage, ST_Area(geometry::geography)/4046.8564224 AS measured
FROM "ParcelOpportunity" WHERE "sourceId" = '…' AND geometry IS NOT NULL LIMIT 10;
```

A disagreement between reported and measured acreage means the projection or the
field mapping is wrong. Fix it before enabling the source.

## 5. Enable it

Set `status: 'ACTIVE'` and `enabled: true`. The worker will pick it up on its
next maintenance sweep.

## Writing a new adapter

Only needed for a genuinely new *shape* of source. Implement `SourceAdapter` in
`packages/ingestion/src/adapters/`, keeping the stages separate:

- `discover()` — locate the current artefact. List URLs change every quarter;
  hard-coding one guarantees a silent failure later.
- `fetchAndParse()` — bytes → raw records. **No interpretation.** Persist the raw
  artefact via `ctx.persistArtifact`.
- `normalize()` — raw records → `ParcelOpportunityInput`. **All interpretation.**
  Emit an `EvidenceInput` for every field a human might act on.

Then register it in `adapters/index.ts`.

### Things that will bite you

- **Pagination.** ArcGIS caps responses at `maxRecordCount` and truncates
  silently. Page with `resultOffset` *and* a stable `orderByFields`, or pages
  will reorder between requests and drop rows.
- **Projections.** Ask the server for `outSR=4326`. It is both cheaper and more
  accurate than reprojecting locally.
- **Money.** County layers publish whole dollars; the domain uses integer cents.
- **Sale status.** Presence in a tax-forfeited layer proves *ownership*, not that
  a parcel is offered for sale. Leave `saleStatus` UNKNOWN and put what the
  analyst must confirm in `acquisitionInstructions`.
- **Long query strings.** Servers reject over-long GETs with a bare 404 that
  looks exactly like a missing layer. Chunk by URL length.
