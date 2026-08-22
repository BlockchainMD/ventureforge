'use client';

import { useState, useTransition } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { recordEnvironmentalScreenAction } from './actions';

type Layer = 'FLOOD' | 'WETLANDS' | 'CONTAMINATION';

/**
 * Where an analyst does the screening, and what they are looking for.
 *
 * The viewer link carries the parcel's coordinates so the map opens on the
 * land rather than on the continental United States. Saving five seconds per
 * parcel is the difference between a screen that gets done before every bid
 * and one that gets skipped.
 */
const LAYERS: Record<
  Layer,
  {
    label: string;
    findingLabel: string;
    placeholder: string;
    viewer: (lat: number, lon: number) => string;
  }
> = {
  FLOOD: {
    label: 'Flood',
    findingLabel: 'Zone codes',
    placeholder: 'AE, X',
    viewer: (lat, lon) =>
      `https://msc.fema.gov/portal/search#searchresultsanchor?lat=${lat}&lon=${lon}`,
  },
  WETLANDS: {
    label: 'Wetlands',
    findingLabel: 'NWI codes',
    placeholder: 'PEM1C, PUBHh',
    viewer: (lat, lon) =>
      `https://www.fws.gov/wetlands/data/mapper.html?lat=${lat}&lon=${lon}&zoom=17`,
  },
  CONTAMINATION: {
    label: 'Cleanup sites',
    findingLabel: 'Nearest site name',
    placeholder: 'Duluth Tar & Chemical',
    viewer: (lat, lon) => `https://geopub.epa.gov/myem/efmap/index.html?ve=17,${lat},${lon}`,
  },
};

export function EnvironmentalScreenForm({
  parcelId,
  latitude,
  longitude,
  screened,
  canAct,
}: {
  parcelId: string;
  latitude: number | null;
  longitude: number | null;
  screened: readonly string[];
  canAct: boolean;
}) {
  const [layer, setLayer] = useState<Layer>('FLOOD');
  const [findings, setFindings] = useState('');
  const [overlapPercent, setOverlapPercent] = useState('');
  const [nearestSiteMeters, setNearestSiteMeters] = useState('');
  const [notes, setNotes] = useState('');
  const [clear, setClear] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canAct) return null;

  const config = LAYERS[layer];
  const viewerUrl =
    latitude != null && longitude != null ? config.viewer(latitude, longitude) : null;

  const submit = (): void => {
    startTransition(async () => {
      const result = await recordEnvironmentalScreenAction(parcelId, {
        layer,
        findings,
        overlapPercent,
        nearestSiteMeters,
        clear,
        sourceUrl: viewerUrl ?? '',
        notes,
      });
      setMessage(result.message);
      if (result.ok) {
        setFindings('');
        setOverlapPercent('');
        setNearestSiteMeters('');
        setNotes('');
        setClear(false);
      }
    });
  };

  return (
    <div className="mt-4 rounded-sm border border-line bg-raised/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="rule-label">Record a manual screen</h3>
        {viewerUrl ? (
          <a
            href={viewerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[11px] text-alpha hover:underline"
          >
            Open {config.label.toLowerCase()} viewer
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-[11px] text-ink-faint">
            No coordinates — viewer link unavailable
          </span>
        )}
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
        These layers are published behind access controls Land Alpha does not work around, so a
        person has to look. What you record here feeds the same screening engine an API response
        would, and is attributed to you.
      </p>

      <div className="mt-3 flex gap-1">
        {(Object.keys(LAYERS) as Layer[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={layer === key ? 'default' : 'outline'}
            onClick={() => setLayer(key)}
            disabled={pending}
          >
            {LAYERS[key].label}
            {screened.includes(key) ? ' ✓' : ''}
          </Button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] text-ink-faint">{config.findingLabel}</span>
          <Input
            value={findings}
            onChange={(event) => setFindings(event.target.value)}
            placeholder={config.placeholder}
            disabled={pending || clear}
          />
        </label>
        {layer === 'CONTAMINATION' ? (
          <label className="block">
            <span className="text-[10px] text-ink-faint">Distance to nearest site (m)</span>
            <Input
              value={nearestSiteMeters}
              onChange={(event) => setNearestSiteMeters(event.target.value)}
              placeholder="450"
              inputMode="numeric"
              disabled={pending || clear}
            />
          </label>
        ) : (
          <label className="block">
            <span className="text-[10px] text-ink-faint">Share of parcel affected (%)</span>
            <Input
              value={overlapPercent}
              onChange={(event) => setOverlapPercent(event.target.value)}
              placeholder="35"
              inputMode="numeric"
              disabled={pending || clear}
            />
          </label>
        )}
      </div>

      <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-muted">
        <input
          type="checkbox"
          checked={clear}
          onChange={(event) => setClear(event.target.checked)}
          disabled={pending}
          className="accent-alpha"
        />
        The viewer maps nothing on this parcel
      </label>

      <label className="mt-2 block">
        <span className="text-[10px] text-ink-faint">Notes (optional)</span>
        <Input
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Zone AE follows the creek along the east boundary"
          disabled={pending}
        />
      </label>

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" variant="good" onClick={submit} disabled={pending}>
          {pending ? 'Recording…' : 'Record screen'}
        </Button>
        {message ? <span className="text-[11px] text-ink-muted">{message}</span> : null}
      </div>
    </div>
  );
}
