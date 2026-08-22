import { defineSources, type RegistryEntry } from './types';

/**
 * The County Opportunity Registry — initial coverage.
 *
 * Every entry records not just where the data is, but how the jurisdiction
 * disposes of land that nobody bought. Entries marked ACTIVE have a working
 * adapter verified against the live endpoint. Entries marked MANUAL_ONLY have
 * been checked and found to be behind a control we will not circumvent.
 * CANDIDATE entries are researched leads awaiting adapter work and human
 * approval — they are never scheduled automatically.
 */
export const SOURCE_REGISTRY: RegistryEntry[] = defineSources([
  // =========================================================================
  // MINNESOTA
  //
  // Minnesota is the anchor state for the Land Alpha thesis. Under Minn. Stat.
  // ch. 282, tax-forfeited land vests in the State and is administered by the
  // county. Parcels that fail at public auction may then be sold over the
  // counter at the prior minimum bid, with no auction and no competition —
  // which is precisely the mispricing this product exists to find.
  // =========================================================================
  {
    key: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    fipsCode: '27137',
    timezone: 'America/Chicago',
    name: 'St. Louis County Tax-Forfeited Land',
    sourceType: 'TAX_FORFEITED',
    sourceUrl:
      'https://gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/7',
    discoveryUrl: 'https://www.stlouiscountymn.gov/departments-a-z/land-minerals',
    ingestionMethod: 'ARCGIS_REST',
    inventoryFormat: 'GIS',
    updateFrequency: 'WEEKLY',
    status: 'ACTIVE',
    enabled: true,
    failedAuctionBecomesOtc: true,
    acquisitionMethod:
      'Public auction administered by the Land & Minerals Department. Parcels unsold at auction may be purchased over the counter at the prior appraised value, first come first served.',
    adapterKey: 'arcgis-parcel-inventory',
    parserVersion: '1',
    officialUrl: 'https://www.stlouiscountymn.gov/',
    assessorUrl: 'https://www.stlouiscountymn.gov/departments-a-z/assessor',
    recorderUrl: 'https://www.stlouiscountymn.gov/departments-a-z/recorder',
    gisUrl: 'https://open-data-slcgis.hub.arcgis.com/',
    taxSaleUrl: 'https://www.stlouiscountymn.gov/departments-a-z/land-minerals',
    attribution: 'St. Louis County, MN — Enterprise GIS',
    dispositionNotes: [
      'St. Louis County is the largest holder of tax-forfeited land in Minnesota, with roughly 14,000 forfeited parcels in the county parcel layer at any time.',
      'Forfeited land is held by the State in trust and administered by the county Land & Minerals Department. Owner name appears in the parcel layer as "ST OF MN" with a chapter/law reference.',
      'Critically for underwriting: presence in this layer means the parcel is tax-forfeited, NOT that it is currently offered for sale. Sale availability must be confirmed against the county auction and over-the-counter lists before bidding.',
      'Much of the inventory is remote, wetland-heavy or landlocked cutover timberland — the rejection rules do most of the work here.',
    ].join(' '),
    notes:
      'The same MapServer publishes Road Centerlines (layer 18) and Zoning (layer 19), which the access and buildability engines read as authoritative county sources rather than relying on crowd-sourced data. Most of the tax-forfeited inventory sits inside Duluth, which the county layer records as "Non Jurisdiction Area" — the city zones it, not the county, so those parcels legitimately come through without a county district.',
    config: {
      layerUrl:
        'https://gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/7',
      where: "Ownership = 'Tax Forfeit'",
      roadsLayerUrl:
        'https://gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/18',
      zoningLayerUrl:
        'https://gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/19',
      fieldMap: {
        apn: 'PRCL_NBR',
        acreage: 'ACREAGE',
        deededAcreage: 'DEEDED_ACRES',
        owner: 'OWNAME',
        legalDescription: 'LEGAL',
        plat: 'PLDESC',
        landAssessedValue: 'LAND_EST',
        taxableLandValue: 'TAXABLE_LAND_VALUE',
        annualTax: 'NET_TAX',
        balanceDue: 'BAL_DUE',
        propertyClass: 'TPCLSCode1',
        situsAddress: 'PHYSADDR',
        situsCity: 'PHYSCITY',
        situsZip: 'PHYSZIP',
        municipality: 'TWPCITY',
      },
      governmentOwner: 'State of Minnesota (tax-forfeited, administered by St. Louis County)',
      ownerType: 'STATE',
      // Sale availability is genuinely unknown from this layer, and saying
      // otherwise would be the exact kind of unsupported claim this product
      // must not make.
      saleStatus: 'UNKNOWN',
      acquisitionInstructions:
        'Confirm current availability with the St. Louis County Land & Minerals Department before bidding. Parcels appear in this layer because they are tax-forfeited, not because they are currently offered.',
    },
  },
  {
    key: 'mn-crow-wing-tax-forfeited',
    state: 'MN',
    county: 'Crow Wing',
    fipsCode: '27035',
    name: 'Crow Wing County Tax-Forfeited Land Sales',
    sourceType: 'TAX_FORFEITED',
    sourceUrl: 'https://taxforfeit.crowwing.us/',
    discoveryUrl: 'https://taxforfeit.crowwing.us/',
    ingestionMethod: 'HTML_TABLE',
    inventoryFormat: 'HTML',
    updateFrequency: 'EVENT_DRIVEN',
    status: 'CANDIDATE',
    enabled: false,
    failedAuctionBecomesOtc: true,
    acquisitionMethod:
      'Auction and over-the-counter sale of tax-forfeited land administered by the Land Services Department.',
    adapterKey: 'manual-import',
    officialUrl: 'https://www.crowwing.gov/',
    dispositionNotes:
      'Crow Wing operates a dedicated tax-forfeit sale site. Lakes-country location means comparatively liquid inventory and stronger comps than the far north. Adapter work pending: the site structure must be reviewed for a stable, machine-readable listing before automation.',
    config: {},
  },
  {
    key: 'mn-mille-lacs-tax-forfeited',
    state: 'MN',
    county: 'Mille Lacs',
    fipsCode: '27095',
    name: 'Mille Lacs County Tax-Forfeited Property',
    sourceType: 'TAX_FORFEITED',
    sourceUrl:
      'https://millelacs.maps.arcgis.com/apps/instant/atlas/index.html?appid=d04f4637a2794aa19f1767f8b7fba8d6',
    ingestionMethod: 'ARCGIS_REST',
    inventoryFormat: 'GIS',
    updateFrequency: 'EVENT_DRIVEN',
    status: 'CANDIDATE',
    enabled: false,
    failedAuctionBecomesOtc: true,
    adapterKey: 'arcgis-parcel-inventory',
    officialUrl: 'https://www.millelacs.mn.gov/',
    dispositionNotes:
      'Publishes a public tax-forfeit viewer. The underlying feature service must be identified and its terms reviewed before this is enabled.',
    config: {},
  },
  {
    key: 'mn-ramsey-tax-forfeited',
    state: 'MN',
    county: 'Ramsey',
    fipsCode: '27123',
    name: 'Ramsey County Tax-Forfeited Property',
    sourceType: 'TAX_FORFEITED',
    sourceUrl:
      'https://ramseygis.maps.arcgis.com/apps/View/index.html?appid=46dbbd89b2ac4f4ab912ba4d0747d31a',
    ingestionMethod: 'ARCGIS_REST',
    inventoryFormat: 'GIS',
    updateFrequency: 'EVENT_DRIVEN',
    status: 'CANDIDATE',
    enabled: false,
    failedAuctionBecomesOtc: false,
    adapterKey: 'arcgis-parcel-inventory',
    officialUrl: 'https://www.ramseycounty.us/',
    dispositionNotes:
      'Urban county: inventory is small, mostly infill lots, and competition is far higher than in the northern forfeit counties. Included for coverage rather than expected yield.',
    config: {},
  },

  // =========================================================================
  // FLORIDA
  //
  // Under Fla. Stat. § 197.502(7), a parcel offered at a tax deed sale that
  // receives no bid goes on the county's "List of Lands Available for Taxes".
  // For the first 90 days only the county may purchase it; after that anyone
  // may buy it for the opening bid plus accrued costs. Three years on, it
  // escheats to the county free and clear.
  //
  // That 90-day-to-3-year window is standing, uncontested, statutorily priced
  // inventory — the closest thing in the country to a published mispricing.
  // =========================================================================
  {
    key: 'fl-orange-lands-available',
    state: 'FL',
    county: 'Orange',
    fipsCode: '12095',
    timezone: 'America/New_York',
    name: 'Orange County Comptroller — Tax Deed Sales & Lands Available',
    sourceType: 'LANDS_AVAILABLE_FOR_TAXES',
    sourceUrl:
      'https://services1.arcgis.com/0U8EQ1FrumPeIqDb/arcgis/rest/services/Tax_Sale_Data/FeatureServer/0',
    discoveryUrl: 'https://www.occompt.com/158/Land-Available-For-Taxes',
    ingestionMethod: 'ARCGIS_REST',
    inventoryFormat: 'GIS',
    updateFrequency: 'WEEKLY',
    status: 'ACTIVE',
    enabled: true,
    failedAuctionBecomesOtc: true,
    acquisitionMethod:
      'Purchase from the Comptroller for the opening bid plus accrued taxes, interest and fees. County has a 90-day priority window after the failed sale; thereafter first come, first served.',
    adapterKey: 'arcgis-tax-sale-points',
    parserVersion: '1',
    officialUrl: 'https://www.occompt.com/',
    assessorUrl: 'https://ocpaweb.ocpafl.org/',
    taxSaleUrl: 'https://www.occompt.com/191/Tax-Deed-Sales',
    attribution: 'Orange County Government GIS / Orange County Comptroller',
    dispositionNotes: [
      'The published layer carries both scheduled tax deed sales ("Active Sale") and the statutory Lands Available list ("Lands Available"); only the latter can be bought on demand.',
      'The layer is deliberately thin — TDA number, sale date, status and parcel ID only, with a point location. Acreage, value and legal description must be enriched from the Property Appraiser, and where that join fails the parcel is carried with unknown acreage rather than a guessed one.',
      'Parcel IDs in the tax-sale layer are in section-township-range order while the parcel layer uses range-township-section, so the join reverses the first three groups — `24-22-32-6214-00-280` becomes `322224621400280`. Against the open-data parcel layer that matches all 55 records; against the BCC layer, which omits municipal parcels, it matched none.',
    ].join(' '),
    config: {
      // The county's republication of its own FIRM. FEMA's host forbids
      // automated queries against the NFHL, and Orange publishes the identical
      // schema — FLD_ZONE, ZONE_SUBTY, SFHA_TF — because it is the same data
      // adopted locally. Without this, every Florida parcel is unscreened for
      // flood and buildability is capped at UNKNOWN.
      floodLayerUrl: 'https://ocgis4.ocfl.net/arcgis/rest/services/AGOL_Open_Data/MapServer/19',
      // Orange County's road inventory. MAINTENANCE states the maintaining body; SURFACE_TYPE and STREET_CLASSIFICATION come free.
      roadsLayerUrl:
        'https://services1.arcgis.com/0U8EQ1FrumPeIqDb/arcgis/rest/services/OCSHARE_Roads_Uninc/FeatureServer/0',
      layerUrl:
        'https://services1.arcgis.com/0U8EQ1FrumPeIqDb/arcgis/rest/services/Tax_Sale_Data/FeatureServer/0',
      // The county's open-data parcel layer, not the BCC one. The BCC layer
      // omits municipal parcels entirely and matched none of the 55 records;
      // this one matched all 55, and carries the boundary, ACREAGE, LAND_MKT,
      // TOTAL_MKT, TAXES, ZONING_CODE and SITUS besides.
      parcelLayerUrl: 'https://ocgis4.ocfl.net/arcgis/rest/services/AGOL_Open_Data/MapServer/56',
      fieldMap: {
        sourceRecordId: 'USER_TDA_NUM',
        apn: 'USER_PARCEL',
        saleDate: 'USER_Sale_Date',
        deedStatus: 'USER_Deed_Status',
      },
      landsAvailableStatus: 'Lands Available',
      acquisitionInstructions:
        'Contact the Orange County Comptroller’s Tax Deed department to obtain the current payoff figure. The purchase price is the opening bid plus accrued taxes, interest and fees, which is not published in this layer.',
    },
  },
  {
    key: 'fl-marion-lands-available',
    state: 'FL',
    county: 'Marion',
    fipsCode: '12083',
    timezone: 'America/New_York',
    name: 'Marion County Clerk — List of Lands Available for Taxes',
    sourceType: 'LANDS_AVAILABLE_FOR_TAXES',
    sourceUrl: 'https://www.marioncountyclerk.org/',
    discoveryUrl: 'https://www.marioncountyclerk.org/',
    ingestionMethod: 'PDF',
    inventoryFormat: 'PDF',
    updateFrequency: 'MONTHLY',
    status: 'ACTIVE',
    enabled: true,
    failedAuctionBecomesOtc: true,
    adapterKey: 'fl-lands-available-pdf',
    officialUrl: 'https://www.marioncountyclerk.org/',
    taxSaleUrl:
      'https://www.marioncountyclerk.org/departments/records-recording/tax-deeds-and-lands-available-for-taxes/land-available-for-taxes-information/',
    attribution: 'Marion County Clerk of Court and Comptroller',
    acquisitionMethod:
      'Purchase from the Clerk for the opening bid plus accrued taxes, interest and fees. County has a 90-day priority window after the failed sale; thereafter first come, first served.',
    dispositionNotes: [
      'The tax-deed *auction* runs on marion.realtaxdeed.com, which answers 403 to an identified client and is therefore out of reach. An earlier investigation stopped there and recorded the whole county as manual-only.',
      'That was too broad. The auction platform and the lands-available list are different things published by different parties, and the Clerk publishes the list on its own site as two PDFs with embedded text: the inventory, and a monthly price sheet giving the purchase amount for each parcel to the cent. robots.txt disallows nothing.',
      'That price sheet is the only per-parcel acquisition price this product has found anywhere. Every other source in the registry requires a telephone call to the county to learn what a parcel costs.',
      'The list is short by construction — it holds what did not sell — but Marion also has the deepest comparable-sales coverage in the registry, so these are the parcels the engine can underwrite end to end rather than merely describe.',
      'The purchase amount rises every month with accruing interest and omitted taxes, so a figure is only correct for the month of the sheet it came from.',
    ].join(' '),
    config: {
      indexUrl:
        'https://www.marioncountyclerk.org/departments/records-recording/tax-deeds-and-lands-available-for-taxes/land-available-for-taxes-information/',
      // The Clerk republishes this file under a new name every month
      // ("2026-August-LAT-Purchase-Amounts-1.pdf"), so the link is discovered
      // from the index page rather than pinned.
      purchaseAmountsPattern: 'LAT[-_ ]?Purchase[-_ ]?Amounts',
      // The price sheet names a parcel and a figure and nothing else. The
      // county's parcel layer carries ACRES, TOT_LND_VA, TOT_VAL, TOT_TAXES,
      // ZONE1 and the boundary for the same identifier, which is the
      // difference between a price and something that can be underwritten.
      parcelLayerUrl: 'https://gis.marionfl.org/public/rest/services/General/Parcels/MapServer/0',
      parcelIdField: 'PARCEL',
      // The county's adoption of the 2017 FIRM, republished by the county
      // itself and carrying the identical NFHL schema — FLD_ZONE, SFHA_TF,
      // ZONE_SUBTY — because it is the same data.
      floodLayerUrl:
        'https://gis.marionfl.org/public/rest/services/General/FEMAFloodZones2017/MapServer/1',
      zoningLayerUrl:
        'https://gis.marionfl.org/public/rest/services/General/PlanningZoning/MapServer/20',
      // Marion states the maintaining body outright in Jurisdiction, which is
      // the field legal access turns on, and marks Paved as a flag.
      roadsLayerUrl:
        'https://gis.marionfl.org/public/rest/services/General/RoadMaintenance/MapServer/7',
      acquisitionInstructions:
        'Complete the Clerk’s LAT Purchase Request Form and mail it with a certified cheque for the purchase amount payable to the Tax Collector, plus a separate cheque for recording fees and documentary stamps payable to the Clerk. First come, first served. Confirm the current month’s figure before sending funds — it rises monthly.',
    },
  },

  // =========================================================================
  // MICHIGAN
  //
  // Under Act 123 of 1999, foreclosed property vests absolutely in the
  // foreclosing governmental unit (usually the county treasurer). It is then
  // offered at auction; parcels unsold at the first auction go to a second
  // "no minimum bid" sale, and what remains stays in treasurer inventory or
  // moves to a land bank. The no-reserve sale is the structural equivalent of
  // Minnesota's over-the-counter roll-through.
  // =========================================================================
  {
    key: 'mi-ottawa-treasurer-inventory',
    state: 'MI',
    county: 'Ottawa',
    fipsCode: '26139',
    timezone: 'America/Detroit',
    name: 'Ottawa County — Treasurer & Land Bank Held Parcels',
    sourceType: 'TAX_FORECLOSURE',
    sourceUrl:
      'https://gis.miottawa.org/arcgis/rest/services/HostedServices/ParcelsPublic/FeatureServer/0',
    discoveryUrl:
      'https://gis.miottawa.org/arcgis/rest/services/HostedServices/ParcelsPublic/FeatureServer/0',
    ingestionMethod: 'ARCGIS_REST',
    inventoryFormat: 'GIS',
    updateFrequency: 'WEEKLY',
    status: 'ACTIVE',
    enabled: true,
    failedAuctionBecomesOtc: true,
    acquisitionMethod:
      'Act 123 tax foreclosure auction, followed by a second no-minimum-bid sale. Parcels still unsold remain in treasurer or land bank inventory and may be sold by negotiated offer.',
    /**
     * Michigan assesses at half of true cash value.
     *
     * A statutory property of the state, not a quirk of Ottawa: assessed value
     * equals the State Equalized Value, and the SEV is set at 50% of true cash
     * value. Every sampled parcel here has AssessedValue exactly equal to
     * SEVValue, and the doubling is what makes the numbers read correctly — a
     * 37.75-acre agricultural parcel at an SEV of $283,100 comes to about
     * $15,000 an acre doubled, which is Ottawa County farmland; at the SEV
     * alone it would be $7,500 and far too low.
     *
     * The 1.15 default suits a jurisdiction assessing at full value, as Florida
     * does. Applying it here understates Michigan land by half.
     *
     * This belongs to the entry, not to `config`. `config` is a bag of unknowns
     * the adapter reads; this is read by the valuation service through
     * `registryByKey(...).assessedValueMultiplier`, so a copy inside `config`
     * type-checks, looks configured, and does nothing at all.
     */
    assessedValueMultiplier: 2,
    adapterKey: 'arcgis-parcel-inventory',
    parserVersion: '1',
    officialUrl: 'https://www.miottawa.org/',
    gisUrl: 'https://gis.miottawa.org/arcgis/rest/services',
    attribution: 'Ottawa County, MI GIS',
    dispositionNotes: [
      'Identified from the authoritative public parcel layer by vesting: parcels whose owner is the county treasurer, the land bank, or the county itself.',
      'The parcel layer carries property class descriptions ("RESIDENTIAL-VACANT", "COMMERCIAL-VACANT"), assessed and taxable values, acreage, legal description and polygon geometry — a materially richer record than most tax-sale lists.',
      'Vesting in the treasurer is strong evidence of foreclosure inventory but does not itself confirm a parcel is offered for sale; that must be confirmed against the treasurer’s published auction list.',
    ].join(' '),
    config: {
      /**
       * The county's parcel-keyed flood table.
       *
       * Ottawa lists every parcel touching a mapped flood zone with the share
       * of each already measured against its own boundary — better than
       * anything derived here, and absence from the table is itself the
       * screening result. Sixty-three of the ninety-nine parcels in inventory
       * appear in it, several of them almost entirely inside the regulatory
       * floodway.
       */
      parcelFloodLayer: {
        url: 'https://gis.miottawa.org/arcgis/rest/services/HostedServices/FloodParcels/FeatureServer/5',
        parcelIdField: 'FinalPIN',
        floodplainPercentField: 'PercentAcresFloodplain',
        floodwayPercentField: 'PercentAcresFloodway',
        floodplain100PercentField: 'PercentAcresFloodplain100',
      },
      // Act 51 legal designation names the maintaining authority outright, which is exactly the field access class A turns on.
      roadsLayerUrl:
        'https://gis.miottawa.org/arcgis/rest/services/HostedServices/StreetCenterlines/FeatureServer/0',
      layerUrl:
        'https://gis.miottawa.org/arcgis/rest/services/HostedServices/ParcelsPublic/FeatureServer/0',
      where:
        "(OwnerName LIKE '%TREASURER%' OR OwnerName LIKE '%LAND BANK%' OR OwnerName LIKE '%COUNTY OF OTTAWA%')",
      fieldMap: {
        apn: 'FinalPIN',
        alternateApn: 'FinalPackedPIN',
        acreage: 'Acreage',
        owner: 'OwnerName',
        legalDescription: 'LegalDesc',
        assessedValue: 'AssessedValue',
        // The inventory is filtered to vacant classes, so the total assessed
        // value is the land value: there is nothing else on the parcel to
        // carry any of it. Without this the valuation fallback never fires and
        // all 99 Ottawa parcels come out unvaluable and so unrankable.
        landAssessedValue: 'AssessedValue',
        taxableValue: 'TaxableValue',
        propertyClass: 'PropertyClass',
        propertyClassDescription: 'PropertyClassDescription',
        situsAddress: 'PropertyAddress',
        situsCity: 'PropertyCity',
        situsZip: 'PropertyZip',
        municipality: 'GovernmentUnitDescription',
      },
      governmentOwner: 'Ottawa County (treasurer / land bank inventory)',
      ownerType: 'COUNTY',
      saleStatus: 'UNKNOWN',
      // Michigan property class 4xx/2xx with "VACANT" in the description is the
      // reliable vacant-land signal in this dataset.
      vacantClassPattern: 'VACANT',
      acquisitionInstructions:
        'Confirm the parcel appears on the Ottawa County Treasurer’s current auction or post-auction list before bidding. Vesting in the treasurer indicates foreclosure inventory, not an active offering.',
    },
  },
  {
    key: 'mi-ottawa-treasurer-auction-list',
    state: 'MI',
    county: 'Ottawa',
    fipsCode: '26139',
    timezone: 'America/Detroit',
    name: 'Ottawa County Treasurer — Delinquent & Foreclosed Property List',
    sourceType: 'TAX_FORECLOSURE',
    sourceUrl: 'https://miottawa.org/treasurer/delinquent/',
    discoveryUrl: 'https://miottawa.org/treasurer/delinquent/',
    ingestionMethod: 'MANUAL_SOURCE',
    inventoryFormat: 'HTML',
    updateFrequency: 'EVENT_DRIVEN',
    status: 'MANUAL_ONLY',
    enabled: false,
    failedAuctionBecomesOtc: true,
    adapterKey: 'manual-import',
    officialUrl: 'https://www.miottawa.org/',
    dispositionNotes: [
      'This host serves a bot-challenge interstitial (sgcaptcha) in place of content, including for robots.txt.',
      'Land Alpha does not circumvent CAPTCHAs or bot protection, so this source is registered MANUAL_ONLY: an analyst downloads the published list and imports it through the manual import workflow, where it is normalised into exactly the same ParcelOpportunity records as an automated source.',
      'This is the intended outcome, not a gap. The registry records the finding so that no future engineer re-investigates it.',
    ].join(' '),
    config: {},
  },
  {
    key: 'fl-citrus-lands-available',
    state: 'FL',
    county: 'Citrus',
    fipsCode: '12017',
    timezone: 'America/New_York',
    name: 'Citrus County Clerk — Tax Deeds & Lands Available for Taxes',
    sourceType: 'LANDS_AVAILABLE_FOR_TAXES',
    sourceUrl: 'https://www.citrusclerk.org/',
    discoveryUrl: 'https://www.citrusclerk.org/',
    ingestionMethod: 'MANUAL_SOURCE',
    inventoryFormat: 'HTML',
    updateFrequency: 'WEEKLY',
    status: 'MANUAL_ONLY',
    enabled: false,
    failedAuctionBecomesOtc: true,
    adapterKey: 'manual-import',
    officialUrl: 'https://www.citrusclerk.org/',
    dispositionNotes: [
      'Same posture as Marion: the auction platform citrus.realtaxdeed.com answers 403 to an identified client and is not worked around.',
      'Citrus has 3,138 geocoded comparables waiting, and its Citrus Springs and Beverly Hills platted lots are the archetypal parcel this product exists to find.',
    ].join(' '),
    config: {},
  },
  {
    key: 'mi-berrien-tax-foreclosure',
    state: 'MI',
    county: 'Berrien',
    fipsCode: '26021',
    timezone: 'America/Detroit',
    name: 'Berrien County Treasurer — Tax Foreclosure Sale',
    sourceType: 'TAX_FORECLOSURE',
    sourceUrl: 'https://www.berriencounty.org/278/Treasurer',
    ingestionMethod: 'MANUAL_SOURCE',
    inventoryFormat: 'MIXED',
    updateFrequency: 'EVENT_DRIVEN',
    status: 'CANDIDATE',
    enabled: false,
    failedAuctionBecomesOtc: true,
    adapterKey: 'manual-import',
    officialUrl: 'https://www.berriencounty.org/',
    dispositionNotes:
      'Southwest Michigan, within weekend range of Chicago — one of the more liquid rural land markets in the state, which matters more for exit than acquisition price does. Auction is run through a third-party platform; its terms must be reviewed before any automated access is considered.',
    config: {},
  },
]);

export function registryByKey(key: string): RegistryEntry | undefined {
  return SOURCE_REGISTRY.find((entry) => entry.key === key);
}

export function registryForState(state: string): RegistryEntry[] {
  return SOURCE_REGISTRY.filter((entry) => entry.state === state.toUpperCase());
}

export function enabledSources(): RegistryEntry[] {
  return SOURCE_REGISTRY.filter((entry) => entry.enabled);
}

/** Coverage summary for the sources dashboard. */
export function registryCoverage(): {
  states: string[];
  counties: number;
  active: number;
  candidates: number;
  manualOnly: number;
} {
  const states = [...new Set(SOURCE_REGISTRY.map((entry) => entry.state))].sort();
  const counties = new Set(
    SOURCE_REGISTRY.filter((entry) => entry.county).map(
      (entry) => `${entry.state}-${entry.county}`,
    ),
  ).size;
  return {
    states,
    counties,
    active: SOURCE_REGISTRY.filter((entry) => entry.status === 'ACTIVE').length,
    candidates: SOURCE_REGISTRY.filter((entry) => entry.status === 'CANDIDATE').length,
    manualOnly: SOURCE_REGISTRY.filter((entry) => entry.status === 'MANUAL_ONLY').length,
  };
}
