# 15. The clerk publishes the price; the auction platform is a different thing

Date: 2026-08-22

## Status

Accepted.

## Context

Across three counties and 304 parcels of inventory, not one carried an
acquisition price. Every rejection rule, every tier, every return figure and the
entire ranked list ran on a number nobody had. The blocked worklist existed
solely to route parcels to a human who would telephone a county and ask.

Marion County was recorded in the registry as MANUAL_ONLY on this reasoning,
written after an earlier investigation:

> The Clerk no longer publishes the list as a PDF on its own site; both the
> tax-deed sale and the lands-available list now live on marion.realtaxdeed.com,
> which answers 403 to an identified client.

The first half of that is true and the second half does not follow. The tax-deed
*auction* runs on realtaxdeed.com and is out of reach, and we do not work around
a 403. But the auction and the statutory lands-available list are different
things published by different parties, and the Clerk publishes the list itself,
on its own domain, as two PDFs with embedded text:

- the inventory, as sale number, sale date, parcel ID and legal description;
- a monthly price sheet giving, for each parcel, the **purchase amount to the
  cent** — the opening bid plus omitted taxes, which is exactly what s.197.502(7)
  says anyone may pay for the land.

`robots.txt` on that site disallows nothing. The PDFs carry embedded text, so
reading them is text extraction rather than OCR, and no access control is
touched.

## Decision

A `fl-lands-available-pdf` adapter reads the price sheet, and Marion moves from
MANUAL_ONLY to ACTIVE.

The price sheet gives an identifier and a figure and nothing else, so the
adapter joins each parcel to the county's public parcel layer on the same
identifier for acreage, assessed values, zoning and boundary. A price without an
area cannot be underwritten, and both halves are needed before the engines can
say anything.

A block whose purchase amount will not parse is rejected with its reason rather
than ingested at zero. The whole value of this list is that it is priced; a
parcel wrongly recorded as free is the exact failure ADR 0012 exists to prevent.

## Consequences

Two parcels. The list is short by construction — it holds what did not sell —
and this is not a volume source.

It is, so far, the only per-parcel acquisition price in the product. Both
parcels went straight through ingestion, enrichment, valuation and scoring, and
both were rejected:

| Parcel | Price | Quick-sale value | All-in basis | Basis/QSV |
|---|---|---|---|---|
| 4033-003-029 | $24,843.16 | $20,431 | $27,174 | 1.33 |
| 5067-420-000 | $26,098.63 | $8,188 | $28,113 | 3.43 |

Both fire `BASIS_EXCEEDS_QSV`. Paying $26,098 for land worth $8,188 is a
catastrophe, and until now the product could not have told anyone so, because it
had no price for any parcel anywhere.

That is the result, and it is the right one. A ranked list of things not to buy
is what an underwriting engine produces most of the time; the failure mode worth
fearing is the one where an unpriced parcel sits at the top of the list looking
free. These two are the first parcels in the product's history to be measured
against what they actually cost.

The figure rises monthly with accruing interest and omitted taxes, so a stored
price is correct only for the month of the sheet it came from, and the source is
scheduled monthly to match.

The general lesson is worth keeping: a 403 from one publisher is a fact about
that publisher, not about the county. Marion was written off on the strength of
a blocked auction platform while the Clerk was publishing the better data —
prices, which the auction platform does not give — in the open the whole time.
