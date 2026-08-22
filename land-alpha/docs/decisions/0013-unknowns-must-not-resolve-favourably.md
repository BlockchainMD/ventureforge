# 0013 — An unknown must never resolve to something favourable

Status: accepted · 2026-08-22

## Context

Twenty iterations of "find and fix the single most important thing" found the
same defect five times, wearing a different coat each time. In every case a
value nobody had established was replaced, somewhere in the pipeline, by one
that flattered the parcel.

| Site | Substitution | Effect |
| --- | --- | --- |
| `valuation.service.ts` | `acquisitionPrice ?? 0` | Unpriced parcels rated EXCEPTIONAL at 1,289% ROI, top of the buy list |
| `enrichment.service.ts` | Unavailable layer → empty array | Robots-blocked and WAF-blocked services read as "nothing here"; the wetland and contamination rejection rules had never fired once |
| `memo.ts` | Empty result → confident absence | "No regulated cleanup site within the search radius", printed for parcels where no search had run |
| `roads.ts` | Failed query → no roads | 228 of 304 parcels penalised on 20% of their score because Overpass answered 503 to every request |
| `scoring.ts` | No valuation → neutral 50 | Parcels with no comparable sales and no value outranked every parcel that had been assessed |
| `allocation.service.ts` | Unpriced parcel → costs-only floor treated as the basis | The capital plan committed $46,000 across twelve parcels whose price nobody had, at a reported 584% a year |

Each one is individually defensible in isolation, which is precisely why they
accumulated. A `?? 0` looks like defensive programming. An empty array looks
like an empty result. A neutral score looks fair.

## Decision

**An unknown is a distinct state and must be represented as one.** It is never
zero, never an empty collection standing in for a measured absence, and never
the midpoint of a scale.

Concretely, the rules that came out of this:

1. **Nullable, not defaulted.** `acquisitionPriceCents: UsdCents | null`. Where
   a null propagates into a ratio, the ratio is null too.

2. **Record what was asked, not only what was answered.**
   `environmentalLayersScreened` and `OpportunityEconomics.priced` exist because
   "we checked and it is clear" and "we never checked" produce identical data
   otherwise. Every downstream claim of absence is gated on the corresponding
   check having happened.

3. **Name the reason, not just the gap.** `describeUnavailable` separates a
   permanent access restriction, a rate limit, and a transient outage. The first
   needs a person, the second needs us to ask less often, the third needs a
   retry. "Not available" conflates all three into something nobody acts on.

4. **The cheap layer is not the screen.** Terrain alone does not constitute an
   environmental screening; if no hazard layer answered, confidence is UNKNOWN
   regardless of how much elevation data we hold.

5. **Unrankable is a valid outcome.** A parcel with no value estimate has a null
   Alpha Score. It is not rejected — nothing is wrong with it — but it does not
   appear in a ranking whose entire purpose is to compare expected returns.

6. **A floor is still a fact.** Suppressing a derived value must not suppress a
   conclusion that stands without it. `basisFloorToQsv` is computed even when
   the price is unknown, because a parcel whose closing and holding costs
   already exceed its value cannot be rescued by any purchase figure.

## Consequence

The product looks materially worse and is materially more correct. 107 of 304
parcels now reject on evidence, every acquisition tier reads UNKNOWN, and the
parcels with the least data have left the top of the list. None of what they
displaced was real.

The cost is that the system now depends on people for three facts — an
acquisition price, a flood screen, a wetlands screen — and says so loudly
rather than inventing them. `/blocked` and the `worklist.notify` digest exist
because an honest gap that nobody is told about is only marginally better than
a dishonest fill.

## A sixth, found later, in a place the first fix did not reach

`computeEconomics` was corrected early: an unpriced parcel returns a null
`basisToQsv`, a null margin and a null return, and the parcel page shows
`unknown` for each. That fix was right and it held.

The allocator did not read any of those fields. It read `estimatedAllInBasis`,
which is present on an unpriced parcel because closing and carrying costs can
be modelled without knowing the purchase price — and then treated it as the
basis. So the same parcel that correctly reads "ROI at QSV: unknown" on its own
page appeared in the capital plan at 4,286% a year, and the plan's headline
said $46,000 was committed when the true figure was unknowable.

The lesson is narrower than the original ADR and worth stating separately: it
is not enough to null the derived figures. A downstream consumer that
recomputes from the raw inputs will reintroduce the defect, because the raw
inputs are still there and still look usable. `AllocationCandidate` now carries
`priced` explicitly, so the engine refuses rather than relying on every caller
to remember.

Where the money is: with unpriced parcels excluded, the plan falls from twelve
parcels to four and from a claimed 584% to 198%, and the page says plainly that
47% of the budget is unspent because too little inventory qualifies — not
because the money ran out. That sentence is the product working.
