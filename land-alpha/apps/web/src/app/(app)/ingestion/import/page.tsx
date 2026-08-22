import { AlertTriangle } from 'lucide-react';
import { manualSources } from '@land-alpha/core';
import { IMPORT_TARGET_FIELDS } from '@land-alpha/ingestion';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { getSessionUser, hasRole } from '@/server/auth';
import { ImportWizard } from './import-wizard';

export const metadata = { title: 'Import inventory — Land Alpha' };
export const dynamic = 'force-dynamic';

/**
 * The analyst import screen.
 *
 * Every source that reaches this page is here because Land Alpha declined to
 * work around something — a CAPTCHA, a 403, a token. The registry has said so
 * for a while; this is where that routing finally leads somewhere.
 */
export default async function ImportPage() {
  const user = await getSessionUser();
  const canImport = user != null && hasRole(user, 'ANALYST');
  const sources = manualSources();

  return (
    <>
      <PageHeader
        title="Import inventory"
        subtitle="For sources that cannot be automated. An imported parcel is enriched, valued and scored exactly like a fetched one."
      />

      <div className="space-y-3 p-3 sm:p-4">
        {!canImport ? (
          <Panel>
            <PanelBody>
              <p className="flex gap-2 py-6 text-xs text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Importing inventory requires the analyst role.
              </p>
            </PanelBody>
          </Panel>
        ) : (
          <ImportWizard sources={sources} targetFields={IMPORT_TARGET_FIELDS} />
        )}

        <Panel>
          <PanelHeader
            title="Why these sources are manual"
            subtitle="Each was investigated and deliberately not automated. The finding is recorded so nobody repeats the work."
          />
          <PanelBody className="space-y-2.5">
            {sources.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-faint">
                No source is currently registered as manual-only.
              </p>
            ) : (
              sources.map((source) => (
                <div key={source.key} className="border-b border-line/60 pb-2 last:border-0">
                  <p className="text-xs text-ink">
                    {source.name}{' '}
                    <span className="text-ink-faint">
                      · {source.county} {source.state}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                    {source.reason}
                  </p>
                </div>
              ))
            )}
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
