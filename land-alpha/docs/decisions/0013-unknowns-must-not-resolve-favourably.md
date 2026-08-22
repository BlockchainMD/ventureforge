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
| `env.ts` | `z.coerce.boolean()` → every non-empty string is `true` | `PUBLIC_SITE_ENABLED=false` read as **true**. The switch that keeps the unauthenticated listing site off did nothing, and the only spelling that worked was the empty string |
| `parcels.ts` | Unmeasured flood/wetland overlap → passes any threshold | `FLOOD ≤ 0%` returned **14,247 of 14,310** live parcels while presenting itself as a satisfied constraint. Screened-only, the honest answer is **30** |
| `parcels.ts` (dashboard) | "Has an all-in basis" read as "has a cost" | IMPLIED DISCOUNT showed **92.5% across 230 parcels**, of which **zero** had a published price. The tooltip named a denominator that did not exist |

Each one is individually defensible in isolation, which is precisely why they
accumulated. A `?? 0` looks like defensive programming. An empty array looks
like an empty result. A neutral score looks fair.

## The ninth was the sixth, in a third consumer

`estimatedAllInBasis` has now caused this three times. It is the costs-only
floor — recording, title, marketing, carry — and it is non-null for an unpriced
parcel because those costs can be modelled without knowing the price. Every
consumer that reads it as "the cost" is reading a number that exists precisely
when the cost does not.

- `valuation.service.ts` substituted `acquisitionPrice ?? 0` (instance one).
- `allocation.service.ts` treated the floor as the basis, and committed $46,000
  to twelve parcels nobody had a price for (instance six).
- `dashboardStats` filtered on `estimatedAllInBasis IS NOT NULL` to decide which
  parcels had "both a published cost and an established value" (this one).

The SQL comment above the third one states the correct rule in full — *"including
their value but not their cost would manufacture an enormous fictitious
discount"* — and then the predicate under it does exactly that. The author knew
the rule, wrote it down, and still reached for the wrong field, because the
wrong field is named as though it were the right one.

**Rule 9 was not enough.** "Nulling the derived figures is not enough" told
consumers not to recompute from raw inputs. It did not stop a consumer from
*testing* a raw input for presence. The addition:

> **A field that is populated when the fact is unknown must not be used to test
> whether the fact is known.** `estimatedAllInBasis` answers "what would this
> cost us if we won it", not "does anyone know the price". The question "is
> there a published price" has exactly one honest test — `askingPrice` or
> `minimumBid` being non-null — and it is now written once, as
> `PRICED_AND_VALUED`, and shared.

The honest figure, once the predicate is right, is that **no live unrejected
parcel in the database has a published price at all** — every priced parcel
found so far has been rejected or withdrawn by its source. The dashboard now
says so rather than deriving 92.5% from the absence.

## The eighth was in a filter, where the analyst had asked the question out loud

The seven above are all things the system computed and handed to a reader. The
eighth is different in a way that makes it worse: the analyst had *typed a
constraint*. Setting `FLOOD ≤ 10%` is an explicit request to see only parcels
screened and found dry, and the filter answered with the entire inventory —
14,247 of 14,310 live parcels, 99.6% of them never measured — while counting
itself among the "N filters active".

The comment justifying it was the usual individually-defensible reasoning:
excluding parcels "we simply have not measured yet" would hide new inventory.
That assumed a backlog. ADR 0011 records that there is none — FEMA's NFHL
disallows us in `robots.txt` and the USGS wetlands service WAF-blocks our
User-Agent, so both layers are MANUAL_SOURCE and stay null for almost
everything. 113 of 14,331 live parcels carry a flood measurement; 20 carry a
wetland one. "Not yet" is the steady state.

The tell was sitting in the same function the whole time. `maxTitleRisk` uses a
plain `lte`, which excludes its 14,312 nulls. One filter bar, two opposite
policies on unknowns, and no label saying which was which.

Screened-only is now the default, `includeUnscreened` brings the old behaviour
back for the discovery case the comment was reaching for, and the controls say
which population they are filtering — "Flood ≤ (%), screened" or "or
unscreened". Turning it on takes `FLOOD ≤ 0%` from 30 parcels back to 14,247,
which is the correct number for a question nobody should ask by accident.

## The seventh instance was not a domain value

The six above are all measurements: a price, a layer, a road, a valuation. The
seventh is a configuration flag, and it arrived by a different route — not a
missing value substituted with a favourable one, but an *unparseable* value
coerced into the permissive direction. `z.coerce.boolean()` is `Boolean(value)`,
so every non-empty string is true, including `'false'`.

The shape is the same and so is the rule. Where a value governs whether
something is exposed, run, or spent, an input the system cannot interpret must
fail closed — and here it must fail loudly, because a flag that silently picks
the permissive side gives no signal at all. `PUBLIC_SITE_ENABLED=flase` is now a
configuration error that stops the boot rather than a decision to publish.

The lesson for review: this defect was invisible in the source. Reading
`PUBLIC_SITE_ENABLED: z.coerce.boolean().default(true)` alongside
`--set-env-vars=PUBLIC_SITE_ENABLED=false` gives every appearance of a control
that works. It was only caught by curling the route in the built image, which is
the argument for verifying safety switches by exercising them in both positions
rather than by reading the code that implements them.

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
