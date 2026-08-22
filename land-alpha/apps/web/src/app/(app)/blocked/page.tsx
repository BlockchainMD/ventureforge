import Link from 'next/link';
import { prisma, toCents, getActiveScoringConfig } from '@land-alpha/db';
import { maximumBidForTargetRatio } from '@land-alpha/valuation';
import { formatAcres, formatCents } from '@land-alpha/shared';
import { FIXTURE_APN_PREFIX } from '@land-alpha/shared/ids';
import { getSessionUser, hasRole } from '@/server/auth';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { BlockedRow } from './blocked-row';
import { CountyRequest } from './county-request';
import { summariseWorklist } from '@land-alpha/core';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Blocked — Land Alpha' };

/**
 * The worklist.
 *
 * Fifty-five Orange County parcels are fully valued, comparable-backed, and
 * impossible to bid on, because the one number that decides whether they are
 * worth buying — the payoff figure — is not published anywhere and has to be
 * asked for. Another two hundred and fifty have never had a hazard layer
 * screened, because the publishers of those layers do not permit automated
 * queries.
 *
 * Both gaps close in minutes per parcel and neither closes on its own. The
 * ranked list is the wrong place to work them: it sorts by opportunity, and a
 * parcel with no price has no computable opportunity, so the parcels that most
 * need a person are the ones the ranking hides. This page sorts by what is
 * missing instead, and puts the entry field next to the reason.
 */

export default async function BlockedPage() {
  const user = await getSessionUser();
  const canAct = user != null && hasRole(user, 'ANALYST');

  const parcels = await prisma.parcelOpportunity.findMany({
    where: {
      removedFromSourceAt: null,
      status: { notIn: ['REJECTED', 'ACQUIRED', 'SOLD'] },
      // A parcel with no value estimate is blocked on comparable sales, which
      // no amount of typing will produce. Those belong on the sources page as
      // a coverage problem, not here as a task.
      quickSaleValue: { not: null },
      // A parcel the engine has already rejected is not waiting on anybody.
      rejected: false,
      // Development fixtures are built to be indistinguishable from real
      // records to the engines, which is what makes them useful. They must not
      // be indistinguishable to a person: what this page produces is a list of
      // parcel references to read down the telephone to a county office, and a
      // synthetic parcel number in that list wastes a clerk's time and the
      // analyst's credibility. There is no county to ring about a fixture.
      apn: { not: { startsWith: FIXTURE_APN_PREFIX } },
      OR: [{ askingPrice: null }, { environmentalLayersScreened: { isEmpty: true } }],
    },
    select: {
      id: true,
      apn: true,
      county: true,
      state: true,
      acreage: true,
      quickSaleValue: true,
      askingPrice: true,
      comparableCount: true,
      saleStatus: true,
      environmentalLayersScreened: true,
      accessClass: true,
      sourceRecordId: true,
      latitude: true,
      longitude: true,
      source: { select: { acquisitionMethod: true, name: true } },
      rejected: true,
    },
    orderBy: [{ quickSaleValue: 'desc' }],
    take: 200,
  });

  // The underwriting boundary, computed here for the same reason it is computed
  // on the parcel page: it needs no acquisition price, so on a parcel whose
  // price is unknown it is the only figure that means anything.
  const config = await getActiveScoringConfig();
  const maxBidFor = (quickSaleValue: Parameters<typeof toCents>[0]): number | null => {
    const cents = toCents(quickSaleValue);
    if (cents == null) return null;
    return maximumBidForTargetRatio({
      quickSaleValueCents: cents,
      targetBasisToQsv: config.thresholds.strongBasisToQsv,
      costs: config.costModel,
      governmentFeesCents: 0,
      annualTaxCents: null,
      titleCurativeCents: null,
    });
  };

  const { dark } = await summariseWorklist();

  // Two different errands, and running them together sends an analyst to ring
  // a county about parcels it may not be selling.
  //
  // "Awaiting a price" is only the right description of a parcel the county has
  // confirmed is for sale. St. Louis County's layer marks land as tax-forfeited,
  // which its own disposition notes say is not the same as offered; Ottawa's
  // marks land vested in the treasurer, which is evidence of foreclosure
  // inventory and not an offering. Between them that is 249 of the 254 real
  // parcels here, and asking for a payoff figure on any of them puts the second
  // question before the first.
  const awaitingPrice = parcels.filter(
    (parcel) => parcel.askingPrice == null && parcel.saleStatus === 'AVAILABLE',
  );
  const unconfirmed = parcels.filter(
    (parcel) => parcel.askingPrice == null && parcel.saleStatus !== 'AVAILABLE',
  );
  const needsPrice = awaitingPrice;

  // Grouped by county, because a county holds one list and answers one enquiry.
  // Forty-six of these sit behind a single Comptroller's office; treating them
  // as forty-six separate errands is the reason the queue does not move.
  const byCounty = [
    ...needsPrice
      .reduce((groups, parcel) => {
        const key = `${parcel.state}/${parcel.county}`;
        const group = groups.get(key) ?? {
          state: parcel.state,
          county: parcel.county,
          parcels: [] as typeof needsPrice,
        };
        group.parcels.push(parcel);
        groups.set(key, group);
        return groups;
      }, new Map<string, { state: string; county: string; parcels: typeof needsPrice }>())
      .entries(),
  ].sort((a, b) => b[1].parcels.length - a[1].parcels.length);
  const needsScreen = parcels.filter(
    (parcel) => parcel.askingPrice != null && parcel.environmentalLayersScreened.length === 0,
  );

  // The value that is currently unreachable. Not a forecast of profit — it is
  // the conservative resale value of parcels nobody can act on, which is the
  // honest measure of what the queue is worth clearing.
  const strandedCents = needsPrice.reduce(
    (total, parcel) => total + (toCents(parcel.quickSaleValue) ?? 0),
    0,
  );

  return (
    <main className="space-y-6 p-4 lg:p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-ink">Blocked on a person</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
          Parcels with an established value that cannot be ranked or bid until someone obtains a
          fact no public endpoint will give us. Everything here is minutes of work per parcel, and
          none of it closes on its own. The queue is split by which fact is missing: a parcel the
          county has confirmed is for sale needs a price, and a parcel that is merely forfeited or
          treasurer-held needs confirming as an offering first.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Confirmed for sale, awaiting a price" value={String(needsPrice.length)} />
        <Stat label="Not confirmed for sale" value={String(unconfirmed.length)} />
        <Stat
          label="Quick-sale value behind the price queue"
          value={strandedCents > 0 ? formatCents(strandedCents) : '—'}
        />
      </div>

      {unconfirmed.length > 0 ? (
        <Panel>
          <PanelHeader
            title="Not confirmed for sale"
            subtitle={`${unconfirmed.length} parcels · the county publishes these as forfeited or treasurer-held, which is not the same as offered`}
          />
          <PanelBody>
            <p className="max-w-3xl text-xs leading-relaxed text-ink-muted">
              Asking a county for a payoff figure on one of these puts the second question before
              the first. The errand here is to confirm the parcel is offered at all — against the
              treasurer’s auction list, or the Land &amp; Minerals over-the-counter list — and only
              then to ask what it costs. Until that is done these are inventory the county happens
              to own, not inventory anyone can buy.
            </p>
          </PanelBody>
        </Panel>
      ) : null}

      {byCounty.map(([key, group]) => (
        <Panel key={key}>
          <PanelHeader
            title={`${group.county} County, ${group.state}`}
            subtitle={`${group.parcels.length} parcels · ${formatCents(
              group.parcels.reduce((total, p) => total + (toCents(p.quickSaleValue) ?? 0), 0),
            )} of quick-sale value waiting on one answer`}
          />
          <PanelBody>
            <CountyRequest
              state={group.state}
              county={group.county}
              references={group.parcels.map((p) => p.sourceRecordId ?? p.apn ?? '').filter(Boolean)}
              acquisitionMethod={group.parcels[0]?.source?.acquisitionMethod ?? null}
              canAct={canAct}
            />
          </PanelBody>
        </Panel>
      ))}

      <Panel>
        <PanelHeader
          title="Awaiting an acquisition price"
          subtitle="Valued and not yet biddable — enter one at a time, or use the county request above"
        />
        <PanelBody className="p-0">
          {needsPrice.length === 0 ? (
            <p className="p-4 text-xs text-ink-muted">Nothing waiting on a price.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-ink-faint">
                  <th className="px-3 py-2 font-normal">Parcel</th>
                  <th className="px-3 py-2 font-normal">Acreage</th>
                  <th className="px-3 py-2 font-normal">Access</th>
                  <th className="px-3 py-2 font-normal">Quick-sale value</th>
                  <th className="px-3 py-2 font-normal">Do not bid above</th>
                  <th className="px-3 py-2 font-normal">Reference</th>
                  <th className="px-3 py-2 font-normal">Price</th>
                </tr>
              </thead>
              <tbody>
                {needsPrice.map((parcel) => (
                  <BlockedRow
                    key={parcel.id}
                    parcelId={parcel.id}
                    apn={parcel.apn ?? '—'}
                    location={`${parcel.county}, ${parcel.state}`}
                    acreage={parcel.acreage == null ? null : formatAcres(parcel.acreage)}
                    accessClass={parcel.accessClass}
                    quickSaleValue={formatCents(toCents(parcel.quickSaleValue))}
                    maxBid={formatCents(maxBidFor(parcel.quickSaleValue))}
                    reference={parcel.sourceRecordId}
                    canAct={canAct}
                  />
                ))}
              </tbody>
            </table>
          )}
        </PanelBody>
      </Panel>

      {dark.length > 0 ? (
        <Panel>
          <PanelHeader
            title="Cannot be valued"
            subtitle="Not rejected, not ranked, and not waiting on anybody"
          />
          <PanelBody className="p-0">
            <ul className="divide-y divide-line">
              {dark.map((county) => (
                <li key={`${county.state}/${county.county}`} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-ink">
                      {county.county} County, {county.state}
                    </span>
                    <span className="num text-xs text-ink-muted">{county.parcels} parcels</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{county.reason}</p>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-3 py-2 text-[10px] leading-relaxed text-ink-faint">
              Nothing is wrong with this land. There is no way to say what it is worth, so it
              carries no score and appears in no ranking — which is also how it would look if it had
              been quietly lost, and the difference is worth stating.
            </p>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="Priced, awaiting a hazard screen"
          subtitle="Flood, wetlands and cleanup sites must be checked by a person"
        />
        <PanelBody className="p-0">
          {needsScreen.length === 0 ? (
            <p className="p-4 text-xs text-ink-muted">Nothing waiting on a screen.</p>
          ) : (
            <ul className="divide-y divide-line">
              {needsScreen.slice(0, 50).map((parcel) => (
                <li key={parcel.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <Link
                    href={`/opportunities/${parcel.id}`}
                    className="num text-xs text-alpha hover:underline"
                  >
                    {parcel.apn}
                  </Link>
                  <span className="text-[11px] text-ink-faint">
                    {parcel.county}, {parcel.state}
                  </span>
                  <span className="num text-xs text-ink">
                    {formatCents(toCents(parcel.quickSaleValue))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-line bg-panel p-3">
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="num mt-1 text-lg text-ink">{value}</p>
    </div>
  );
}
