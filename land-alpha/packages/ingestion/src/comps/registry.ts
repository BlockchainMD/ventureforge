import { type CompsSourceInput, defineCompsSources, type CompsSource } from './types';

/**
 * The comparable-sales registry.
 *
 * Deliberately records what is *not* available as carefully as what is.
 * Valuation quality gates every downstream decision in this product, so an
 * engineer arriving later needs to know which counties have real sales data,
 * which are behind a token, and which were checked and found to publish
 * nothing — otherwise the same investigation gets repeated.
 */
/**
 * A Florida county's comparable sales, from the state roll.
 *
 * Florida is the one state in scope that publishes the same two files for all
 * 67 of its counties, so adding a county is configuration rather than an
 * adapter. Every entry below has been confirmed present in the current
 * submission round; what varies between them is how much vacant land actually
 * changes hands, which the import reports rather than this file guessing.
 */
function floridaCounty(county: string, note: string): CompsSourceInput {
  return {
    key: `fl-${county.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-sales`,
    state: 'FL',
    county,
    name: `Florida DOR tax roll — ${county} County qualified vacant sales`,
    adapterKey: 'fl-dor-roll',
    sourceUrl:
      'https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx',
    status: 'ACTIVE',
    // Registered but not run by default: each import pulls a property roll of
    // tens of megabytes from a public server, and doing that for counties whose
    // inventory we do not yet carry would be taking without needing.
    enabled: false,
    attribution:
      'Florida Department of Revenue, Property Tax Oversight — Name-Address-Legal and Sale Data File assessment rolls',
    notes: note,
    config: { county, soldSince: '2019-01-01' },
  };
}

export const COMPS_REGISTRY: CompsSource[] = defineCompsSources([
  // =========================================================================
  // ACTIVE — verified against the live endpoint
  // =========================================================================
  {
    key: 'mn-grant-sales',
    state: 'MN',
    county: 'Grant',
    name: 'Grant County MN Assessor — Tax Parcel Sales',
    adapterKey: 'arcgis-assessor-sales',
    sourceUrl:
      'https://gis.co.grant.mn.us/arcgis/rest/services/Assessor/TaxParcels_public/FeatureServer/3',
    status: 'ACTIVE',
    enabled: true,
    attribution: 'Grant County, MN Assessor',
    notes:
      'The assessor publishes its sales-ratio study table without a token, already classified as vacant/improved and qualified/disqualified — exactly the two judgements a valuation needs and cannot make for itself. ~1,100 qualified vacant-land sales with price, date, deeded acreage and parcel geometry.',
    config: {
      layerUrl:
        'https://gis.co.grant.mn.us/arcgis/rest/services/Assessor/TaxParcels_public/FeatureServer/3',
      where: "goodsale = 'Yes'",
      soldSince: '2015-01-01',
      fieldMap: {
        apn: 'PARCELID',
        saleDate: 'TRANSDT',
        salePrice: 'SALEAMNT',
        acreage: 'DEEDED_ACRES',
        propertyClass: 'SALE_PROPERTY_CLASS',
        vacantFlag: 'SALE_VACANT_IMPROVED',
        qualifiedFlag: 'goodsale',
        deedType: 'DOCNAME',
        municipality: 'CITY_TWP_NAME',
      },
      vacantClassPatterns: ['BARE LAND', 'VACANT'],
      qualifiedValues: ['Yes', 'Y'],
    },
  },

  // =========================================================================
  // NOT AUTOMATABLE — checked, and why
  // =========================================================================
  {
    key: 'mn-st-louis-sales',
    state: 'MN',
    county: 'St. Louis',
    name: 'St. Louis County MN Assessor — Sales Comp Finder / Sales Study',
    adapterKey: 'manual-comps-import',
    sourceUrl: 'https://gis.stlouiscountymn.gov/server2/rest/services/ASSR_SalesCompFinder',
    status: 'TOKEN_REQUIRED',
    enabled: false,
    notes:
      'The county runs ASSR_SalesCompFinder and ASSR_SalesStudy, but both return HTTP 499 "Token Required" — they are internal assessor services, not open data. Land Alpha does not attempt to obtain or use a token it was not granted. Comparable sales for this county arrive through the CSV import workflow, or through a licensed data agreement. This is the flagship inventory county, so closing this gap is the highest-value data-partnership conversation to have.',
    config: {},
  },
  {
    key: 'fl-orange-sales',
    state: 'FL',
    county: 'Orange',
    name: 'Florida DOR tax roll — Orange County qualified vacant sales',
    adapterKey: 'fl-dor-roll',
    sourceUrl:
      'https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx',
    status: 'ACTIVE',
    enabled: true,
    attribution:
      'Florida Department of Revenue, Property Tax Oversight — Name-Address-Legal and Sale Data File assessment rolls',
    notes:
      "Replaces the county's public BCC parcel layer, which covers unincorporated Orange County only and yields fewer than twenty qualified vacant-land sales. The state roll yields several hundred, carries the property appraiser's own vacant/improved and sale-qualification determinations, and uses one format for all 67 Florida counties.",
    config: {
      county: 'Orange',
      soldSince: '2019-01-01',
    },
  },
  {
    key: 'mi-ottawa-sales',
    state: 'MI',
    county: 'Ottawa',
    name: 'Ottawa County MI — recorded sales',
    adapterKey: 'manual-comps-import',
    sourceUrl:
      'https://gis.miottawa.org/arcgis/rest/services/HostedServices/ParcelsPublic/FeatureServer/0',
    status: 'UNAVAILABLE',
    enabled: false,
    notes:
      'The public parcel layer carries assessed and taxable values but no sale price or sale date, and the county publishes no separate sales service. Michigan sale data is recorded on property transfer affidavits held by the local assessing unit. Comparable sales for this county must be imported.',
    config: {},
  },
  {
    key: 'mn-mille-lacs-sales',
    state: 'MN',
    county: 'Mille Lacs',
    name: 'Mille Lacs County MN — assessor tax parcels',
    adapterKey: 'manual-comps-import',
    sourceUrl:
      'https://gis.co.mille-lacs.mn.us/arcgis/rest/services/Assessors/TaxParcels/MapServer/0',
    status: 'UNAVAILABLE',
    enabled: false,
    notes:
      'The county publishes one assessor parcel layer and it carries no sale price, sale date, qualification code or acreage — nothing a comparable needs. Checked alongside Crow Wing (no public ArcGIS host), Aitkin and Itasca (no host reachable). Minnesota has no statewide equivalent of the Florida roll, so each county has to be investigated on its own and most publish nothing usable.',
    config: {},
  },
  floridaCounty(
    'Marion',
    'Ocala and the surrounding acreage — one of the most active vacant-land markets in the state, and the county behind the Lands Available PDF adapter on the roadmap.',
  ),
  floridaCounty(
    'Polk',
    'Between Tampa and Orlando, with a large stock of platted-but-unbuilt subdivision lots — the archetypal parcel this product exists to find.',
  ),
  floridaCounty(
    'Lake',
    'Rural acreage immediately north-west of Orange County; the natural comparable market for larger Orange parcels, which Orange itself has few of.',
  ),
  floridaCounty(
    'Volusia',
    'Deltona and the surrounding platted lots, adjacent to both Orange and Lake.',
  ),
  floridaCounty(
    'Osceola',
    'South of Orange, with extensive platted rural subdivisions from the 1960s and 70s.',
  ),
  floridaCounty(
    'Citrus',
    'Citrus Springs and Beverly Hills — very large inventories of small platted lots that transact steadily and cheaply.',
  ),
]);

export function compsSourceByKey(key: string): CompsSource | undefined {
  return COMPS_REGISTRY.find((entry) => entry.key === key);
}

export function enabledCompsSources(): CompsSource[] {
  return COMPS_REGISTRY.filter((entry) => entry.enabled);
}

/** Which of our inventory counties actually have real comparable sales. */
export function compsCoverage(): {
  active: string[];
  needsImport: string[];
} {
  return {
    active: COMPS_REGISTRY.filter((entry) => entry.status === 'ACTIVE').map(
      (entry) => `${entry.county}, ${entry.state}`,
    ),
    needsImport: COMPS_REGISTRY.filter((entry) => entry.status !== 'ACTIVE').map(
      (entry) => `${entry.county}, ${entry.state}`,
    ),
  };
}
