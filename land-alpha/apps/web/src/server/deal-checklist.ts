/**
 * The due-diligence checklist.
 *
 * Exactly the list from the product specification, grouped so that the deal
 * room reads as a workflow rather than a wall of tick-boxes. Items marked
 * `required` block the "ready to bid" transition when unchecked — the point of
 * a checklist that can be skipped is unclear.
 */
export interface ChecklistItemSpec {
  readonly key: string;
  readonly label: string;
  readonly category: 'IDENTITY' | 'PHYSICAL' | 'LEGAL' | 'ENVIRONMENTAL' | 'FINANCIAL';
  readonly required: boolean;
  readonly guidance: string;
}

export const DEAL_CHECKLIST: ChecklistItemSpec[] = [
  {
    key: 'apn_verified',
    label: 'APN verified',
    category: 'IDENTITY',
    required: true,
    guidance: 'Confirm the parcel number against the assessor’s own record, not the sale list.',
  },
  {
    key: 'geometry_verified',
    label: 'Parcel geometry verified',
    category: 'IDENTITY',
    required: true,
    guidance: 'Confirm the mapped polygon is this parcel and not a neighbouring one.',
  },
  {
    key: 'acreage_verified',
    label: 'Acreage verified',
    category: 'IDENTITY',
    required: true,
    guidance: 'Reconcile deeded acreage against the GIS measurement; investigate any gap over 10%.',
  },
  {
    key: 'road_adjacency',
    label: 'Road adjacency checked',
    category: 'PHYSICAL',
    required: true,
    guidance: 'Confirm on imagery that the parcel physically touches the road it appears to.',
  },
  {
    key: 'legal_access',
    label: 'Legal access verified',
    category: 'LEGAL',
    required: true,
    guidance:
      'Cite the recorded instrument granting access — a plat dedication, an easement, or frontage on a dedicated public way. Physical adjacency is not legal access.',
  },
  {
    key: 'zoning_verified',
    label: 'Zoning verified with the county',
    category: 'LEGAL',
    required: true,
    guidance: 'Confirm the district and permitted uses with the zoning office, not from GIS alone.',
  },
  {
    key: 'min_lot_size',
    label: 'Minimum lot size verified',
    category: 'LEGAL',
    required: true,
    guidance: 'Check whether a substandard lot qualifies as a grandfathered lot of record.',
  },
  {
    key: 'flood_reviewed',
    label: 'Flood reviewed',
    category: 'ENVIRONMENTAL',
    required: true,
    guidance: 'Check the effective FIRM panel, not only the web map.',
  },
  {
    key: 'wetlands_reviewed',
    label: 'Wetlands reviewed',
    category: 'ENVIRONMENTAL',
    required: true,
    guidance: 'NWI is a screening layer. Consider a delineation where usable area is marginal.',
  },
  {
    key: 'septic_water',
    label: 'Septic and water status reviewed',
    category: 'ENVIRONMENTAL',
    required: true,
    guidance: 'Ask the county health department whether a septic permit is achievable here.',
  },
  {
    key: 'utilities_reviewed',
    label: 'Utilities reviewed',
    category: 'PHYSICAL',
    required: false,
    guidance: 'Distance to electrical service, and the cost of extending it.',
  },
  {
    key: 'title_prescreen',
    label: 'Title pre-screen completed',
    category: 'LEGAL',
    required: true,
    guidance: 'Review the automated pre-screen and its unknowns.',
  },
  {
    key: 'title_professional',
    label: 'Title professional consulted if needed',
    category: 'LEGAL',
    required: false,
    guidance: 'Required whenever the pre-screen risk score exceeds 40.',
  },
  {
    key: 'taxes_verified',
    label: 'Taxes and assessments verified',
    category: 'FINANCIAL',
    required: true,
    guidance: 'Obtain the current payoff figure in writing; accrued amounts change monthly.',
  },
  {
    key: 'special_assessments',
    label: 'Special assessments checked',
    category: 'FINANCIAL',
    required: true,
    guidance: 'Municipal assessments frequently survive a tax sale.',
  },
  {
    key: 'hoa_poa',
    label: 'HOA / POA checked',
    category: 'FINANCIAL',
    required: false,
    guidance: 'Association dues can run with the land and outlive the tax deed.',
  },
  {
    key: 'environmental_issues',
    label: 'Environmental issues reviewed',
    category: 'ENVIRONMENTAL',
    required: true,
    guidance: 'Check state and federal cleanup registries for the site and its neighbours.',
  },
  {
    key: 'comps_verified',
    label: 'Comparable sales verified',
    category: 'FINANCIAL',
    required: true,
    guidance: 'Spot-check at least three comps against the recorded deed.',
  },
  {
    key: 'max_bid',
    label: 'Maximum bid established',
    category: 'FINANCIAL',
    required: true,
    guidance: 'Set before the auction, in writing, and do not move it during one.',
  },
];

export const CHECKLIST_CATEGORIES: {
  key: ChecklistItemSpec['category'];
  label: string;
}[] = [
  { key: 'IDENTITY', label: 'Identity' },
  { key: 'PHYSICAL', label: 'Physical' },
  { key: 'LEGAL', label: 'Legal' },
  { key: 'ENVIRONMENTAL', label: 'Environmental' },
  { key: 'FINANCIAL', label: 'Financial' },
];

export function guidanceFor(key: string): string {
  return DEAL_CHECKLIST.find((item) => item.key === key)?.guidance ?? '';
}
