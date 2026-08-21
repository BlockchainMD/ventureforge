import type { TitlePreScreen } from '@land-alpha/shared';

/**
 * The human research queue.
 *
 * Most county recorders cannot be searched programmatically — many sit behind
 * a session-based search form or a third-party portal with terms that forbid
 * automated access. Rather than guessing, Land Alpha generates a precise task
 * for a person, with the exact search to run and the exact question to answer.
 */

export interface TitleResearchTaskSpec {
  readonly taskType:
    | 'CHAIN_OF_TITLE'
    | 'LIEN_SEARCH'
    | 'EASEMENT_SEARCH'
    | 'LEGAL_ACCESS_VERIFICATION'
    | 'VESTING_RECONCILIATION'
    | 'PROBATE_REVIEW';
  readonly instructions: string;
  readonly priority: 'HIGH' | 'NORMAL';
}

export function deriveResearchTasks(input: {
  prescreen: TitlePreScreen;
  apn: string | null;
  county: string;
  state: string;
  recorderUrl: string | null;
  legalAccessUnknown: boolean;
  recorderRequiresManualSearch: boolean;
}): TitleResearchTaskSpec[] {
  const tasks: TitleResearchTaskSpec[] = [];
  const parcelRef = input.apn ? `APN ${input.apn}` : 'this parcel';
  const where = `${input.county} County, ${input.state}`;

  if (input.recorderRequiresManualSearch || input.prescreen.chainDepth < 2) {
    tasks.push({
      taskType: 'CHAIN_OF_TITLE',
      priority: 'HIGH',
      instructions: [
        `Search the ${where} recorder for ${parcelRef}.`,
        'Retrieve the current vesting deed and trace back at least three conveyances.',
        'Record for each: instrument number, recording date, grantor, grantee, and instrument type.',
        input.recorderUrl ? `Recorder: ${input.recorderUrl}` : '',
        'Flag any conveyance where the grantor is not the grantee of the preceding deed.',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  if (input.prescreen.findings.some((finding) => finding.severity === 'MAJOR')) {
    tasks.push({
      taskType: 'LIEN_SEARCH',
      priority: 'HIGH',
      instructions: [
        `Run a name-based lien and judgment search for every owner in the chain for ${parcelRef} in ${where}.`,
        'Include federal tax liens, state tax liens, judgments, and municipal special assessments.',
        'For each hit, determine whether the interest survives the tax sale under this state’s statute.',
      ].join('\n'),
    });
  }

  if (input.legalAccessUnknown) {
    tasks.push({
      taskType: 'LEGAL_ACCESS_VERIFICATION',
      priority: 'HIGH',
      instructions: [
        `Establish whether ${parcelRef} in ${where} has recorded legal access.`,
        'Check: the recorded plat, any access or ingress/egress easements, dedicated public right-of-way, and the county road inventory.',
        'Physical adjacency to a road is NOT sufficient. Cite the instrument that grants access, or state that none was found.',
      ].join('\n'),
    });
  }

  if (input.prescreen.findings.some((finding) => finding.instrumentType === 'PROBATE_INDICATOR')) {
    tasks.push({
      taskType: 'PROBATE_REVIEW',
      priority: 'NORMAL',
      instructions: [
        `The chain for ${parcelRef} passes through an estate.`,
        'Locate the probate file, confirm the personal representative had authority to convey, and identify any heirs whose interest was not released.',
      ].join('\n'),
    });
  }

  return tasks;
}
