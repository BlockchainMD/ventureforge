# 0012 — An unpublished acquisition price is not a price of zero

Status: accepted · 2026-08-22

## Context

Every parcel in inventory — all 304 — has a null `askingPrice` and a null
`minimumBid`. Not one carries a published acquisition cost.

`valuation.service.ts` resolved that to zero:

```ts
const acquisitionPriceCents =
  toCents(parcel.askingPrice) ?? toCents(parcel.minimumBid) ?? toCents(parcel.taxesDue) ?? 0;
```

The consequence, read straight out of the database:

| APN | Acquisition | All-in basis | QSV | basis/QSV | ROI | Tier |
| --- | --- | --- | --- | --- | --- | --- |
| 19-22-29-6956-04-070 | null | $3,517 | $48,860 | 7.2% | **1,289%** | **EXCEPTIONAL** |
| 33-20-28-7106-00-120 | null | $3,474 | $48,134 | 7.2% | 1,286% | EXCEPTIONAL |
| 27-22-30-3539-00-090 | null | $3,336 | $45,840 | 7.3% | 1,274% | EXCEPTIONAL |

The basis was pure closing and carrying costs. The ratio was near zero because
the largest term was missing. The tier fell out as EXCEPTIONAL, the ROI as four
figures, and these parcels sat at the top of the ranked list — which is the
list an operator acts on.

There was a warning ("the all-in basis is a floor rather than an estimate") and
valuation confidence dropped to LOW. Neither stops a fabricated 1,289% return
from being computed, persisted and ranked. A caveat attached to a number does
not undo the number.

This is the same defect as decision 0011, in the place where it costs the most:
an unknown substituted with a favourable known.

## Decision

`EconomicsInputs.acquisitionPriceCents` is `UsdCents | null`, and null means
unknown.

When it is null, `computeEconomics` reports `priced: false` and returns null for
`basisToQsv`, `basisToRetail`, `grossProfitAtQsv`, `roiAtQsv` and
`annualizedRoiAtQsv`. `classifyTier` already returns UNKNOWN for a null ratio,
so the tier follows without further change. `allInBasis` is still reported: it
is a genuine floor, and knowing that owning a parcel costs $3,300 before you
have paid for it is useful.

`priced` is an explicit field rather than an `acquisitionPrice === 0` test,
because a parcel acquired for nothing and a parcel of unknown cost are different
facts that must not share a representation.

The recommended maximum bid is still computed, and is now the most useful figure
on an unpriced parcel: it is the arithmetic inverse of the underwriting standard
— what the parcel is worth bidding — and it needs no acquisition price to
derive.

## Getting the price

For Orange County the payoff figure is the opening bid plus accrued taxes,
interest and fees, obtained from the Comptroller on request. The published
ArcGIS layer carries five fields — TDA number, sale date, deed status, parcel ID
and a point — and no price; that was verified against the service, not assumed.

So the price is entered by an analyst, through a control on the parcel page that
writes to `askingPrice` and immediately re-runs valuation and scoring. It lands
exactly where a published price would, so nothing downstream needs a special
case, and the audit log preserves that a person supplied it and where they got
it.

## Consequence

Parcels with no obtained price no longer carry a tier, a return or a margin, and
the headline discount component of the Alpha Score scores neutral at UNKNOWN
confidence rather than near-maximum. The ranked list will reorder, and the top
of it will be materially less exciting. It was never real.
