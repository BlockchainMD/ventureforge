'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  ACCESS_CLASSES,
  BUILDABILITY_RATINGS,
  SOURCE_TYPES,
  activeFilterCount,
  filterFromSearchParams,
  humanizeEnum,
} from '@land-alpha/shared';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Filter bar.
 *
 * State lives entirely in the URL. That is what makes a filtered view
 * shareable, bookmarkable and — crucially — savable as a saved search and
 * reusable as an alert rule without any translation layer, because a saved
 * search *is* a serialised `OpportunityFilter`.
 */
export function FilterBar({ counties }: { counties: { state: string; county: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Sixteen controls is a reasonable toolbar on a terminal and an entire
  // screenful on a phone, so below `lg` everything but search is disclosed.
  const [expanded, setExpanded] = useState(false);

  const filter = useMemo(
    () => filterFromSearchParams(new URLSearchParams(params.toString())),
    [params],
  );
  const count = activeFilterCount(filter);

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
      // Any filter change resets to page one; staying on page 7 of a narrower
      // result set is the classic way to show an analyst an empty screen.
      next.delete('page');
      startTransition(() => router.push(`/opportunities?${next.toString()}`));
    },
    [params, router],
  );

  const clearAll = useCallback(() => {
    startTransition(() => router.push('/opportunities'));
  }, [router]);

  const statesInInventory = [...new Set(counties.map((c) => c.state))].sort();

  return (
    <div className="border-b border-line bg-surface px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className="block min-w-0 flex-1 sm:w-48 sm:flex-none">
          <span className="rule-label">Search</span>
          <Input
            className="mt-0.5"
            defaultValue={filter.q ?? ''}
            placeholder="APN, county, legal…"
            onKeyDown={(event) => {
              if (event.key === 'Enter') update('q', event.currentTarget.value);
            }}
          />
        </label>

        <Button
          variant={count > 0 ? 'subtle' : 'outline'}
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="shrink-0 lg:hidden"
        >
          <SlidersHorizontal className="size-3" />
          Filters{count > 0 ? ` (${count})` : ''}
        </Button>

        {/* `lg:contents` dissolves this wrapper on a wide screen, so the
            desktop toolbar wraps exactly as it did before it existed. */}
        <div
          className={cn(
            'w-full flex-wrap items-end gap-x-3 gap-y-2 lg:contents',
            expanded ? 'flex' : 'hidden',
          )}
        >
          <NumberFilter
            label="Alpha ≥"
            value={filter.minAlphaScore}
            onChange={(v) => update('minAlphaScore', v)}
            placeholder="0"
            width="w-16"
          />
          <NumberFilter
            label="Price ≤ ($)"
            value={filter.maxPrice == null ? undefined : filter.maxPrice / 100}
            onChange={(v) => update('maxPrice', v == null ? null : String(Number(v) * 100))}
            placeholder="any"
            width="w-20"
          />
          <NumberFilter
            label="Acres ≥"
            value={filter.minAcreage}
            onChange={(v) => update('minAcreage', v)}
            placeholder="0"
            width="w-16"
          />
          <NumberFilter
            label="Acres ≤"
            value={filter.maxAcreage}
            onChange={(v) => update('maxAcreage', v)}
            placeholder="any"
            width="w-16"
          />
          <NumberFilter
            label="Basis/QSV ≤ (%)"
            value={
              filter.maxBasisToQsv == null ? undefined : Math.round(filter.maxBasisToQsv * 100)
            }
            onChange={(v) => update('maxBasisToQsv', v == null ? null : String(Number(v) / 100))}
            placeholder="any"
            width="w-20"
          />
          <NumberFilter
            label="Title ≤"
            value={filter.maxTitleRisk}
            onChange={(v) => update('maxTitleRisk', v)}
            placeholder="100"
            width="w-16"
          />

          <label className="block w-24">
            <span className="rule-label">State</span>
            <Select
              className="mt-0.5"
              value={filter.states?.[0] ?? ''}
              onChange={(event) => update('states', event.target.value || null)}
            >
              <option value="">All</option>
              {statesInInventory.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </Select>
          </label>

          <label className="block w-40">
            <span className="rule-label">County</span>
            <Select
              className="mt-0.5"
              value={filter.counties?.[0] ?? ''}
              onChange={(event) => update('counties', event.target.value || null)}
            >
              <option value="">All</option>
              {counties
                .filter((c) => !filter.states?.length || filter.states.includes(c.state))
                .map((c) => (
                  <option key={`${c.state}-${c.county}`} value={c.county}>
                    {c.county}, {c.state}
                  </option>
                ))}
            </Select>
          </label>

          <label className="block w-44">
            <span className="rule-label">Source type</span>
            <Select
              className="mt-0.5"
              value={filter.sourceTypes?.[0] ?? ''}
              onChange={(event) => update('sourceTypes', event.target.value || null)}
            >
              <option value="">All</option>
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanizeEnum(type)}
                </option>
              ))}
            </Select>
          </label>

          <label className="block w-24">
            <span className="rule-label">Access</span>
            <Select
              className="mt-0.5"
              value={filter.accessClasses?.[0] ?? ''}
              onChange={(event) => update('accessClasses', event.target.value || null)}
            >
              <option value="">All</option>
              {ACCESS_CLASSES.map((cls) => (
                <option key={cls} value={cls}>
                  {cls}
                </option>
              ))}
            </Select>
          </label>

          <label className="block w-28">
            <span className="rule-label">Buildability</span>
            <Select
              className="mt-0.5"
              value={filter.buildability?.[0] ?? ''}
              onChange={(event) => update('buildability', event.target.value || null)}
            >
              <option value="">All</option>
              {BUILDABILITY_RATINGS.map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </Select>
          </label>

          <NumberFilter
            label={environmentalLabel('Flood', filter.includeUnscreened)}
            value={
              filter.maxFloodOverlap == null ? undefined : Math.round(filter.maxFloodOverlap * 100)
            }
            onChange={(v) => update('maxFloodOverlap', v == null ? null : String(Number(v) / 100))}
            placeholder="any"
            width="w-20"
          />
          <NumberFilter
            label={environmentalLabel('Wetland', filter.includeUnscreened)}
            value={
              filter.maxWetlandOverlap == null
                ? undefined
                : Math.round(filter.maxWetlandOverlap * 100)
            }
            onChange={(v) =>
              update('maxWetlandOverlap', v == null ? null : String(Number(v) / 100))
            }
            placeholder="any"
            width="w-20"
          />
          <NumberFilter
            label="Failed sales ≥"
            value={filter.minFailedSaleCount}
            onChange={(v) => update('minFailedSaleCount', v)}
            placeholder="0"
            width="w-20"
          />

          <div className="flex items-center gap-2 pb-0.5">
            <Toggle
              label="Offered for sale"
              active={filter.offeredOnly === true}
              onToggle={() => update('offeredOnly', filter.offeredOnly ? null : 'true')}
            />
            {filter.maxFloodOverlap != null || filter.maxWetlandOverlap != null ? (
              <Toggle
                label="Include unscreened"
                active={filter.includeUnscreened === true}
                onToggle={() =>
                  update('includeUnscreened', filter.includeUnscreened ? null : 'true')
                }
              />
            ) : null}
            <Toggle
              label="OTC only"
              active={filter.otcOnly === true}
              onToggle={() => update('otcOnly', filter.otcOnly ? null : 'true')}
            />
            <Toggle
              label="No reserve"
              active={filter.noReserveOnly === true}
              onToggle={() => update('noReserveOnly', filter.noReserveOnly ? null : 'true')}
            />
            <Toggle
              label="Watchlist"
              active={filter.watchlistedOnly === true}
              onToggle={() => update('watchlistedOnly', filter.watchlistedOnly ? null : 'true')}
            />
            <Toggle
              label="Show rejected"
              active={filter.includeRejected === true}
              onToggle={() => update('includeRejected', filter.includeRejected ? null : 'true')}
            />
          </div>

          {count > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearAll} className="mb-0.5">
              <X className="size-3" />
              Clear {count}
            </Button>
          ) : null}
          {pending ? (
            <Badge tone="muted" className="mb-1">
              updating…
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NumberFilter({
  label,
  value,
  onChange,
  placeholder,
  width,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: string | null) => void;
  placeholder: string;
  width: string;
}) {
  return (
    <label className={`block ${width}`}>
      <span className="rule-label">{label}</span>
      <Input
        className="mt-0.5"
        type="number"
        defaultValue={value ?? ''}
        placeholder={placeholder}
        onBlur={(event) => onChange(event.currentTarget.value || null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onChange(event.currentTarget.value || null);
        }}
      />
    </label>
  );
}

function Toggle({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-sm border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? 'border-alpha/50 bg-alpha/10 text-alpha'
          : 'border-line-strong text-ink-faint hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Say which population the threshold is being applied to.
 *
 * FEMA and the USGS wetlands service both refuse us (ADR 0011), so almost
 * nothing carries a measurement. A bare "Flood ≤ (%)" reads as a satisfied
 * constraint over the whole list; it is a constraint over the ~1% that has been
 * screened, unless the operator has deliberately asked for the rest.
 */
function environmentalLabel(layer: 'Flood' | 'Wetland', includeUnscreened?: boolean): string {
  return includeUnscreened ? `${layer} ≤ (%) or unscreened` : `${layer} ≤ (%), screened`;
}
