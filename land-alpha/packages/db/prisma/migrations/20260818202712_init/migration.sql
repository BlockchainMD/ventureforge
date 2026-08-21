-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "JurisdictionType" AS ENUM ('STATE', 'COUNTY', 'MUNICIPALITY', 'AGENCY');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('TAX_FORECLOSURE', 'TAX_FORFEITED', 'OVER_THE_COUNTER', 'LANDS_AVAILABLE_FOR_TAXES', 'REOFFER', 'FINAL_SALE', 'NO_RESERVE', 'COUNTY_SURPLUS', 'CITY_SURPLUS', 'STATE_SURPLUS', 'DNR_SURPLUS', 'DOT_SURPLUS', 'LAND_BANK', 'OTHER');

-- CreateEnum
CREATE TYPE "IngestionMethod" AS ENUM ('API', 'ARCGIS_REST', 'CSV_EXPORT', 'XLSX_EXPORT', 'HTML_TABLE', 'HTML_DETAIL', 'PDF', 'MANUAL_SOURCE');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('ACTIVE', 'CANDIDATE', 'PENDING_APPROVAL', 'DEGRADED', 'BROKEN', 'MANUAL_ONLY', 'RETIRED');

-- CreateEnum
CREATE TYPE "UpdateFrequency" AS ENUM ('REALTIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'EVENT_DRIVEN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IngestionRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ChangeKind" AS ENUM ('CREATED', 'PRICE_CHANGED', 'AUCTION_DATE_CHANGED', 'SALE_STATUS_CHANGED', 'ATTRIBUTES_CHANGED', 'REAPPEARED', 'REMOVED_FROM_SOURCE');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('AUCTION', 'SEALED_BID', 'OVER_THE_COUNTER', 'APPLICATION', 'NEGOTIATED', 'LISTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('AVAILABLE', 'SCHEDULED', 'PENDING', 'SOLD', 'WITHDRAWN', 'EXPIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ParcelStatus" AS ENUM ('DISCOVERED', 'ENRICHING', 'SCORED', 'REJECTED', 'WATCHLIST', 'DUE_DILIGENCE', 'READY_TO_BID', 'APPROVED', 'BID_PLACED', 'WON', 'LOST', 'PURCHASE_PENDING', 'ACQUIRED', 'TITLE_CURATIVE', 'READY_TO_LIST', 'LISTED', 'UNDER_CONTRACT', 'SOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnalystDisposition" AS ENUM ('UNREVIEWED', 'PURSUE', 'MONITOR', 'PASS', 'NEEDS_RESEARCH');

-- CreateEnum
CREATE TYPE "AccessClass" AS ENUM ('A', 'B', 'C', 'D', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LegalAccessStatus" AS ENUM ('UNKNOWN', 'RECORDED_FRONTAGE', 'RECORDED_EASEMENT', 'PLATTED_ACCESS', 'PRESCRIPTIVE_CLAIMED', 'NO_RECORDED_ACCESS_FOUND', 'DISPUTED');

-- CreateEnum
CREATE TYPE "BuildabilityRating" AS ENUM ('GREEN', 'YELLOW', 'RED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('COUNTY', 'CITY', 'STATE', 'FEDERAL', 'LAND_BANK', 'PRIVATE_INDIVIDUAL', 'PRIVATE_ENTITY', 'TRUST', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'OFFER', 'NEGOTIATING', 'CONTRACT', 'CLOSED', 'LOST');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ANALYST',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jurisdiction" (
    "id" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "county" TEXT,
    "municipality" TEXT,
    "fipsCode" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "type" "JurisdictionType" NOT NULL,
    "officialUrl" TEXT,
    "assessorUrl" TEXT,
    "recorderUrl" TEXT,
    "gisUrl" TEXT,
    "taxSaleUrl" TEXT,
    "dispositionNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Jurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JurisdictionInsight" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JurisdictionInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "registryKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "discoveryUrl" TEXT,
    "ingestionMethod" "IngestionMethod" NOT NULL,
    "updateFrequency" "UpdateFrequency" NOT NULL DEFAULT 'UNKNOWN',
    "inventoryFormat" TEXT,
    "failedAuctionBecomesOtc" BOOLEAN NOT NULL DEFAULT false,
    "acquisitionMethod" TEXT,
    "adapterKey" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL DEFAULT '1',
    "sourceStatus" "SourceStatus" NOT NULL DEFAULT 'CANDIDATE',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "attribution" TEXT,
    "termsUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDiscoveryCandidate" (
    "id" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "county" TEXT,
    "candidateUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT,
    "matchedTerms" TEXT[],
    "suggestedType" "SourceType",
    "suggestedMethod" "IngestionMethod",
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdSourceId" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "IngestionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "parserVersion" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL DEFAULT 'scheduler',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "recordsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsChanged" INTEGER NOT NULL DEFAULT 0,
    "recordsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "recordsRemoved" INTEGER NOT NULL DEFAULT 0,
    "recordsRejected" INTEGER NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "bytesFetched" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawArtifact" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalUrl" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelChange" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "ingestionRunId" TEXT,
    "kind" "ChangeKind" NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelOpportunity" (
    "id" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "county" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "apn" TEXT,
    "apnNormalized" TEXT,
    "alternateApns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceRecordId" TEXT,
    "naturalKey" TEXT NOT NULL,
    "saleType" "SaleType" NOT NULL DEFAULT 'UNKNOWN',
    "saleStatus" "SaleStatus" NOT NULL DEFAULT 'UNKNOWN',
    "auctionDate" TIMESTAMP(3),
    "offerDeadline" TIMESTAMP(3),
    "minimumBid" DECIMAL(14,2),
    "askingPrice" DECIMAL(14,2),
    "taxesDue" DECIMAL(14,2),
    "fees" DECIMAL(14,2),
    "estimatedAcquisitionCost" DECIMAL(14,2),
    "priorAuctionStatus" TEXT,
    "priorAuctionDate" TIMESTAMP(3),
    "priorMinimumBid" DECIMAL(14,2),
    "failedSaleCount" INTEGER NOT NULL DEFAULT 0,
    "otcEligible" BOOLEAN,
    "acquisitionInstructions" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedFromSourceAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geometry" geometry(Geometry, 4326),
    "centroid" geometry(Point, 4326),
    "geometrySource" TEXT,
    "geometryConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "acreage" DOUBLE PRECISION,
    "lotSquareFeet" DOUBLE PRECISION,
    "bboxWest" DOUBLE PRECISION,
    "bboxSouth" DOUBLE PRECISION,
    "bboxEast" DOUBLE PRECISION,
    "bboxNorth" DOUBLE PRECISION,
    "perimeterMeters" DOUBLE PRECISION,
    "compactness" DOUBLE PRECISION,
    "aspectRatio" DOUBLE PRECISION,
    "shapeFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roadFrontageMeters" DOUBLE PRECISION,
    "nearestRoadName" TEXT,
    "nearestRoadMeters" DOUBLE PRECISION,
    "nearestPavedRoadName" TEXT,
    "nearestPavedRoadMeters" DOUBLE PRECISION,
    "municipality" TEXT,
    "zip" TEXT,
    "situsAddress" TEXT,
    "legalDescription" TEXT,
    "assessedValue" DECIMAL(14,2),
    "taxableValue" DECIMAL(14,2),
    "landAssessedValue" DECIMAL(14,2),
    "improvementAssessedValue" DECIMAL(14,2),
    "propertyClass" TEXT,
    "isVacant" BOOLEAN,
    "currentUse" TEXT,
    "zoning" TEXT,
    "zoningSource" TEXT,
    "zoningConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "minimumLotSizeAcres" DOUBLE PRECISION,
    "knownUtilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "annualTaxEstimate" DECIMAL(14,2),
    "currentOwner" TEXT,
    "ownerType" "OwnerType" NOT NULL DEFAULT 'UNKNOWN',
    "governmentOwner" TEXT,
    "priorOwner" TEXT,
    "acquisitionDate" TIMESTAMP(3),
    "lastDeedDate" TIMESTAMP(3),
    "accessClass" "AccessClass" NOT NULL DEFAULT 'UNKNOWN',
    "physicalAccessScore" DOUBLE PRECISION,
    "legalAccessStatus" "LegalAccessStatus" NOT NULL DEFAULT 'UNKNOWN',
    "legalAccessConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "touchesPublicRoad" BOOLEAN,
    "touchesNamedRoad" BOOLEAN,
    "apparentDriveway" BOOLEAN,
    "potentiallyLandlocked" BOOLEAN,
    "accessEvidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accessUnknowns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "floodZones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "floodOverlapFraction" DOUBLE PRECISION,
    "inSpecialFloodHazardArea" BOOLEAN,
    "wetlandTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wetlandOverlapFraction" DOUBLE PRECISION,
    "soilSeries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "soilDrainageClasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hydricSoilFraction" DOUBLE PRECISION,
    "nearestContaminatedSiteMeters" DOUBLE PRECISION,
    "contaminatedSites" JSONB NOT NULL DEFAULT '[]',
    "meanElevationMeters" DOUBLE PRECISION,
    "minElevationMeters" DOUBLE PRECISION,
    "maxElevationMeters" DOUBLE PRECISION,
    "meanSlopePercent" DOUBLE PRECISION,
    "environmentalRiskScore" DOUBLE PRECISION,
    "environmentalConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "buildability" "BuildabilityRating" NOT NULL DEFAULT 'UNKNOWN',
    "buildabilityScore" DOUBLE PRECISION,
    "buildabilityReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buildabilityUnknowns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buildabilityBlockers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buildabilityConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "retailValueLow" DECIMAL(14,2),
    "retailValue" DECIMAL(14,2),
    "retailValueHigh" DECIMAL(14,2),
    "quickSaleValue" DECIMAL(14,2),
    "quickSaleValueLow" DECIMAL(14,2),
    "quickSaleValueHigh" DECIMAL(14,2),
    "investorLiquidationValue" DECIMAL(14,2),
    "valuationConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "comparableCount" INTEGER NOT NULL DEFAULT 0,
    "valuationMethod" TEXT,
    "valuationWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedAllInBasis" DECIMAL(14,2),
    "estimatedCarryingCost" DECIMAL(14,2),
    "estimatedTitleCost" DECIMAL(14,2),
    "estimatedCurativeCost" DECIMAL(14,2),
    "estimatedMarketingCost" DECIMAL(14,2),
    "estimatedRecordingCost" DECIMAL(14,2),
    "basisToQsv" DOUBLE PRECISION,
    "basisToRetail" DOUBLE PRECISION,
    "expectedGrossMargin" DECIMAL(14,2),
    "roiAtQsv" DOUBLE PRECISION,
    "annualizedRoiAtQsv" DOUBLE PRECISION,
    "economicsTier" TEXT,
    "alphaScore" DOUBLE PRECISION,
    "valueScore" DOUBLE PRECISION,
    "accessScore" DOUBLE PRECISION,
    "buildabilityScoreNorm" DOUBLE PRECISION,
    "titleRiskScore" DOUBLE PRECISION,
    "liquidityScore" DOUBLE PRECISION,
    "shapeScore" DOUBLE PRECISION,
    "desirabilityScore" DOUBLE PRECISION,
    "confidenceScore" DOUBLE PRECISION,
    "confidenceLevel" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "scoringConfigVersion" TEXT,
    "whyInteresting" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "remainingQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReasons" JSONB NOT NULL DEFAULT '[]',
    "rejectionOverriddenBy" TEXT,
    "rejectionOverrideNote" TEXT,
    "status" "ParcelStatus" NOT NULL DEFAULT 'DISCOVERED',
    "analystDisposition" "AnalystDisposition" NOT NULL DEFAULT 'UNREVIEWED',
    "watchlisted" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "approvedMaxBid" DECIMAL(14,2),
    "approvedMaxBidBy" TEXT,
    "approvedMaxBidAt" TIMESTAMP(3),
    "actualPurchasePrice" DECIMAL(14,2),
    "acquiredAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "salePrice" DECIMAL(14,2),
    "publicSlug" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "scoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParcelOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "documentKey" TEXT,
    "extractedText" TEXT,
    "retrievalDate" TIMESTAMP(3) NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "extractionMethod" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelNote" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelDocument" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "sourceUrl" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparableSale" (
    "id" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "county" TEXT NOT NULL,
    "apn" TEXT,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "salePrice" DECIMAL(14,2) NOT NULL,
    "acreage" DOUBLE PRECISION NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "centroid" geometry(Point, 4326),
    "zoning" TEXT,
    "landUse" TEXT,
    "accessClass" "AccessClass",
    "hasUtilities" BOOLEAN,
    "isVacantLand" BOOLEAN NOT NULL DEFAULT true,
    "isArmsLength" BOOLEAN NOT NULL DEFAULT true,
    "deedType" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT,

    CONSTRAINT "ComparableSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparableLink" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "comparableId" TEXT NOT NULL,
    "valuationSnapshotId" TEXT,
    "distanceMeters" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL,
    "adjustedPricePerAcre" DECIMAL(14,2) NOT NULL,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComparableLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelValuationSnapshot" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "retailValue" DECIMAL(14,2),
    "quickSaleValue" DECIMAL(14,2),
    "investorLiquidationValue" DECIMAL(14,2),
    "confidence" "ConfidenceLevel" NOT NULL,
    "comparableCount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelValuationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelScoreSnapshot" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "alphaScore" DOUBLE PRECISION NOT NULL,
    "configVersion" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringConfig" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "weights" JSONB NOT NULL,
    "thresholds" JSONB NOT NULL,
    "rejectionRules" JSONB NOT NULL,
    "costModel" JSONB NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoringConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionOutcome" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "minimumBid" DECIMAL(14,2),
    "winningBid" DECIMAL(14,2),
    "bidderCount" INTEGER,
    "soldToUs" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TitleInstrument" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "instrumentType" TEXT NOT NULL,
    "recordedDate" TIMESTAMP(3),
    "bookPage" TEXT,
    "instrumentNo" TEXT,
    "grantor" TEXT,
    "grantee" TEXT,
    "amount" DECIMAL(14,2),
    "description" TEXT,
    "documentKey" TEXT,
    "sourceUrl" TEXT,
    "chainPosition" INTEGER,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TitleInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TitleResearchTask" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "recorderUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "findings" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TitleResearchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "openedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetMaxBid" DECIMAL(14,2),
    "approvedMaxBid" DECIMAL(14,2),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "dueDiligenceAcknowledgedBy" TEXT,
    "dueDiligenceAcknowledgedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "summary" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealChecklistItem" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "findings" TEXT,

    CONSTRAINT "DealChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealDocument" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "checklistKey" TEXT,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealNote" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "checklistKey" TEXT,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioAsset" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "acquisitionPrice" DECIMAL(14,2) NOT NULL,
    "closingCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "improvementCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "titleCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxesPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "carryingCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marketingCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "listPrice" DECIMAL(14,2),
    "soldAt" TIMESTAMP(3),
    "salePrice" DECIMAL(14,2),
    "sellingCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "realizedProfit" DECIMAL(14,2),
    "realizedRoi" DOUBLE PRECISION,
    "daysHeld" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioTransaction" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "longDescription" TEXT NOT NULL,
    "keyFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationSummary" TEXT NOT NULL,
    "drivingDirections" TEXT,
    "nearbyAttractions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "propertyFacts" JSONB NOT NULL DEFAULT '[]',
    "faq" JSONB NOT NULL DEFAULT '[]',
    "dueDiligenceDisclosure" TEXT NOT NULL,
    "seoTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "socialCopy" TEXT NOT NULL,
    "askingPrice" DECIMAL(14,2),
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "generatedBy" TEXT NOT NULL DEFAULT 'listing-engine',
    "generatorVersion" TEXT NOT NULL DEFAULT '1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingVariant" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPhoto" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'PUBLIC_SITE',
    "inquiry" TEXT,
    "offerAmount" DECIMAL(14,2),
    "financing" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedTo" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['IN_APP']::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastMatchAt" TIMESTAMP(3),
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertRuleId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkPath" TEXT,
    "parcelId" TEXT,
    "readAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentMemo" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "recommendedMaxBid" DECIMAL(14,2),
    "evidenceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unknowns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "generatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentMemo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualImport" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "sourceId" TEXT,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "detectedColumns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ManualImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_createdAt_idx" ON "ActivityLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "Jurisdiction_state_idx" ON "Jurisdiction"("state");

-- CreateIndex
CREATE INDEX "Jurisdiction_fipsCode_idx" ON "Jurisdiction"("fipsCode");

-- CreateIndex
CREATE UNIQUE INDEX "Jurisdiction_state_county_municipality_key" ON "Jurisdiction"("state", "county", "municipality");

-- CreateIndex
CREATE INDEX "JurisdictionInsight_jurisdictionId_topic_idx" ON "JurisdictionInsight"("jurisdictionId", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "Source_registryKey_key" ON "Source"("registryKey");

-- CreateIndex
CREATE INDEX "Source_jurisdictionId_idx" ON "Source"("jurisdictionId");

-- CreateIndex
CREATE INDEX "Source_sourceType_idx" ON "Source"("sourceType");

-- CreateIndex
CREATE INDEX "Source_sourceStatus_enabled_idx" ON "Source"("sourceStatus", "enabled");

-- CreateIndex
CREATE INDEX "SourceDiscoveryCandidate_status_score_idx" ON "SourceDiscoveryCandidate"("status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDiscoveryCandidate_state_candidateUrl_key" ON "SourceDiscoveryCandidate"("state", "candidateUrl");

-- CreateIndex
CREATE INDEX "IngestionRun_sourceId_startedAt_idx" ON "IngestionRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "IngestionRun_status_idx" ON "IngestionRun"("status");

-- CreateIndex
CREATE INDEX "RawArtifact_sourceId_fetchedAt_idx" ON "RawArtifact"("sourceId", "fetchedAt");

-- CreateIndex
CREATE INDEX "RawArtifact_sha256_idx" ON "RawArtifact"("sha256");

-- CreateIndex
CREATE INDEX "ParcelChange_parcelId_detectedAt_idx" ON "ParcelChange"("parcelId", "detectedAt");

-- CreateIndex
CREATE INDEX "ParcelChange_kind_detectedAt_idx" ON "ParcelChange"("kind", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelOpportunity_naturalKey_key" ON "ParcelOpportunity"("naturalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelOpportunity_publicSlug_key" ON "ParcelOpportunity"("publicSlug");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_state_county_idx" ON "ParcelOpportunity"("state", "county");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_sourceId_idx" ON "ParcelOpportunity"("sourceId");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_jurisdictionId_idx" ON "ParcelOpportunity"("jurisdictionId");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_status_idx" ON "ParcelOpportunity"("status");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_alphaScore_idx" ON "ParcelOpportunity"("alphaScore" DESC);

-- CreateIndex
CREATE INDEX "ParcelOpportunity_basisToQsv_idx" ON "ParcelOpportunity"("basisToQsv");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_auctionDate_idx" ON "ParcelOpportunity"("auctionDate");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_apnNormalized_idx" ON "ParcelOpportunity"("apnNormalized");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_watchlisted_idx" ON "ParcelOpportunity"("watchlisted");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_rejected_status_idx" ON "ParcelOpportunity"("rejected", "status");

-- CreateIndex
CREATE INDEX "ParcelOpportunity_lastSeenAt_idx" ON "ParcelOpportunity"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Evidence_parcelId_field_idx" ON "Evidence"("parcelId", "field");

-- CreateIndex
CREATE INDEX "Evidence_parcelId_createdAt_idx" ON "Evidence"("parcelId", "createdAt");

-- CreateIndex
CREATE INDEX "ParcelNote_parcelId_createdAt_idx" ON "ParcelNote"("parcelId", "createdAt");

-- CreateIndex
CREATE INDEX "ParcelDocument_parcelId_category_idx" ON "ParcelDocument"("parcelId", "category");

-- CreateIndex
CREATE INDEX "ComparableSale_state_county_saleDate_idx" ON "ComparableSale"("state", "county", "saleDate");

-- CreateIndex
CREATE INDEX "ComparableSale_acreage_idx" ON "ComparableSale"("acreage");

-- CreateIndex
CREATE UNIQUE INDEX "ComparableSale_state_county_apn_saleDate_salePrice_key" ON "ComparableSale"("state", "county", "apn", "saleDate", "salePrice");

-- CreateIndex
CREATE INDEX "ComparableLink_parcelId_idx" ON "ComparableLink"("parcelId");

-- CreateIndex
CREATE UNIQUE INDEX "ComparableLink_parcelId_comparableId_valuationSnapshotId_key" ON "ComparableLink"("parcelId", "comparableId", "valuationSnapshotId");

-- CreateIndex
CREATE INDEX "ParcelValuationSnapshot_parcelId_createdAt_idx" ON "ParcelValuationSnapshot"("parcelId", "createdAt");

-- CreateIndex
CREATE INDEX "ParcelScoreSnapshot_parcelId_createdAt_idx" ON "ParcelScoreSnapshot"("parcelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringConfig_version_key" ON "ScoringConfig"("version");

-- CreateIndex
CREATE INDEX "ScoringConfig_isActive_idx" ON "ScoringConfig"("isActive");

-- CreateIndex
CREATE INDEX "AuctionOutcome_parcelId_eventDate_idx" ON "AuctionOutcome"("parcelId", "eventDate");

-- CreateIndex
CREATE INDEX "AuctionOutcome_eventType_eventDate_idx" ON "AuctionOutcome"("eventType", "eventDate");

-- CreateIndex
CREATE INDEX "TitleInstrument_parcelId_chainPosition_idx" ON "TitleInstrument"("parcelId", "chainPosition");

-- CreateIndex
CREATE INDEX "TitleInstrument_parcelId_instrumentType_idx" ON "TitleInstrument"("parcelId", "instrumentType");

-- CreateIndex
CREATE INDEX "TitleResearchTask_status_createdAt_idx" ON "TitleResearchTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TitleResearchTask_parcelId_idx" ON "TitleResearchTask"("parcelId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_parcelId_key" ON "Deal"("parcelId");

-- CreateIndex
CREATE INDEX "DealChecklistItem_dealId_ordering_idx" ON "DealChecklistItem"("dealId", "ordering");

-- CreateIndex
CREATE UNIQUE INDEX "DealChecklistItem_dealId_key_key" ON "DealChecklistItem"("dealId", "key");

-- CreateIndex
CREATE INDEX "DealDocument_dealId_idx" ON "DealDocument"("dealId");

-- CreateIndex
CREATE INDEX "DealNote_dealId_createdAt_idx" ON "DealNote"("dealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioAsset_parcelId_key" ON "PortfolioAsset"("parcelId");

-- CreateIndex
CREATE INDEX "PortfolioAsset_soldAt_idx" ON "PortfolioAsset"("soldAt");

-- CreateIndex
CREATE INDEX "PortfolioTransaction_assetId_occurredAt_idx" ON "PortfolioTransaction"("assetId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_parcelId_key" ON "Listing"("parcelId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_slug_key" ON "Listing"("slug");

-- CreateIndex
CREATE INDEX "Listing_published_idx" ON "Listing"("published");

-- CreateIndex
CREATE UNIQUE INDEX "ListingVariant_listingId_channel_key" ON "ListingVariant"("listingId", "channel");

-- CreateIndex
CREATE INDEX "ListingPhoto_listingId_ordering_idx" ON "ListingPhoto"("listingId", "ordering");

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_parcelId_idx" ON "Lead"("parcelId");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_userId_name_key" ON "SavedSearch"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_userId_name_key" ON "Watchlist"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_parcelId_key" ON "WatchlistItem"("watchlistId", "parcelId");

-- CreateIndex
CREATE INDEX "AlertRule_enabled_idx" ON "AlertRule"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AlertRule_userId_name_key" ON "AlertRule"("userId", "name");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "InvestmentMemo_parcelId_createdAt_idx" ON "InvestmentMemo"("parcelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentMemo_parcelId_version_key" ON "InvestmentMemo"("parcelId", "version");

-- CreateIndex
CREATE INDEX "ManualImport_status_createdAt_idx" ON "ManualImport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_runAt_priority_idx" ON "Job"("status", "runAt", "priority" DESC);

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JurisdictionInsight" ADD CONSTRAINT "JurisdictionInsight_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawArtifact" ADD CONSTRAINT "RawArtifact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawArtifact" ADD CONSTRAINT "RawArtifact_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelChange" ADD CONSTRAINT "ParcelChange_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelChange" ADD CONSTRAINT "ParcelChange_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelOpportunity" ADD CONSTRAINT "ParcelOpportunity_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelOpportunity" ADD CONSTRAINT "ParcelOpportunity_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelNote" ADD CONSTRAINT "ParcelNote_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelNote" ADD CONSTRAINT "ParcelNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelDocument" ADD CONSTRAINT "ParcelDocument_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparableLink" ADD CONSTRAINT "ComparableLink_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparableLink" ADD CONSTRAINT "ComparableLink_comparableId_fkey" FOREIGN KEY ("comparableId") REFERENCES "ComparableSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparableLink" ADD CONSTRAINT "ComparableLink_valuationSnapshotId_fkey" FOREIGN KEY ("valuationSnapshotId") REFERENCES "ParcelValuationSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelValuationSnapshot" ADD CONSTRAINT "ParcelValuationSnapshot_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelScoreSnapshot" ADD CONSTRAINT "ParcelScoreSnapshot_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionOutcome" ADD CONSTRAINT "AuctionOutcome_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleInstrument" ADD CONSTRAINT "TitleInstrument_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleResearchTask" ADD CONSTRAINT "TitleResearchTask_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealChecklistItem" ADD CONSTRAINT "DealChecklistItem_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealChecklistItem" ADD CONSTRAINT "DealChecklistItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioAsset" ADD CONSTRAINT "PortfolioAsset_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "PortfolioAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingVariant" ADD CONSTRAINT "ListingVariant_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPhoto" ADD CONSTRAINT "ListingPhoto_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentMemo" ADD CONSTRAINT "InvestmentMemo_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualImport" ADD CONSTRAINT "ManualImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
