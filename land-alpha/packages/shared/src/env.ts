import { z } from 'zod';
import { ConfigurationError } from './errors';

/**
 * Environment validation.
 *
 * Land Alpha must be fully runnable with nothing but a Postgres URL. Every
 * external integration is optional and degrades to a documented fixture mode
 * rather than crashing, so a new engineer can clone, migrate, seed and see the
 * whole product without a single API key.
 */

const optionalUrl = z.string().url().optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Required -------------------------------------------------------------
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // --- Sessions -------------------------------------------------------------
  /** 32+ chars. Auto-generated ephemeral value in development only. */
  AUTH_SECRET: z.string().min(32).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  // --- Queue ----------------------------------------------------------------
  REDIS_URL: z.string().optional(),
  QUEUE_DRIVER: z.enum(['postgres', 'bullmq']).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),

  // --- Object storage -------------------------------------------------------
  STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
  STORAGE_LOCAL_DIR: z.string().default('./data/storage'),
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // --- AI -------------------------------------------------------------------
  /** `fixture` needs no credentials and is the default. */
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'fixture']).default('fixture'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL_REASONING: z.string().default('claude-opus-4-5'),
  AI_MODEL_FAST: z.string().default('claude-sonnet-4-5'),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  AI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.2),

  // --- Ingestion politeness -------------------------------------------------
  INGEST_USER_AGENT: z
    .string()
    .default('LandAlphaBot/0.1 (+https://landalpha.example/bot; contact@landalpha.example)'),
  INGEST_CONTACT_EMAIL: z.string().email().default('contact@landalpha.example'),
  INGEST_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
  INGEST_MAX_REQUESTS_PER_RUN: z.coerce.number().int().positive().default(600),
  INGEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  INGEST_RESPECT_ROBOTS: z.coerce.boolean().default(true),
  /** When true, adapters read from `data/fixtures/raw` instead of the network. */
  INGEST_OFFLINE: z.coerce.boolean().default(false),

  // --- Enrichment services --------------------------------------------------
  /** `fixture` uses the bundled local datasets; `live` calls the public APIs. */
  ENRICHMENT_MODE: z.enum(['fixture', 'live']).default('fixture'),
  FEMA_NFHL_URL: z
    .string()
    .default('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer'),
  USFWS_WETLANDS_URL: z
    .string()
    .default('https://www.fws.gov/wetlandsmapservice/rest/services/Wetlands/MapServer'),
  USDA_SOILS_URL: z.string().default('https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest'),
  EPA_FRS_URL: z.string().default('https://data.epa.gov/efservice'),
  USGS_EPQS_URL: z.string().default('https://epqs.nationalmap.gov/v1/json'),
  OVERPASS_URL: z.string().default('https://overpass-api.de/api/interpreter'),

  // --- Web ------------------------------------------------------------------
  NEXT_PUBLIC_APP_NAME: z.string().default('Land Alpha'),
  /**
   * Public origin of the listing site, used for canonical URLs and the
   * sitemap. Search engines need absolute URLs; a relative one in a sitemap is
   * simply ignored.
   */
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_MAP_STYLE_URL: z.string().optional(),
  PUBLIC_SITE_ENABLED: z.coerce.boolean().default(true),

  // --- Email ----------------------------------------------------------------
  EMAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z.string().optional(),
  ALERT_FROM_EMAIL: z.string().email().default('alerts@landalpha.example'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigurationError(`Invalid environment configuration:\n  ${issues.join('\n  ')}`, {
      issues,
    });
  }
  return applyDerivedDefaults(parsed.data);
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test seam. */
export function resetEnvCache(): void {
  cached = null;
}

function applyDerivedDefaults(value: Env): Env {
  const queueDriver = value.QUEUE_DRIVER ?? (value.REDIS_URL ? 'bullmq' : 'postgres');

  if (value.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!value.AUTH_SECRET) missing.push('AUTH_SECRET');
    if (value.STORAGE_DRIVER === 's3' && !value.S3_BUCKET) missing.push('S3_BUCKET');
    if (value.AI_PROVIDER === 'anthropic' && !value.ANTHROPIC_API_KEY) {
      missing.push('ANTHROPIC_API_KEY');
    }
    if (value.AI_PROVIDER === 'openai' && !value.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Missing required production environment variables: ${missing.join(', ')}`,
        { missing },
      );
    }
  }

  return { ...value, QUEUE_DRIVER: queueDriver };
}

/** True when a live AI provider is configured and usable. */
export function aiEnabled(value: Env = env()): boolean {
  if (value.AI_PROVIDER === 'fixture') return false;
  if (value.AI_PROVIDER === 'anthropic') return Boolean(value.ANTHROPIC_API_KEY);
  return Boolean(value.OPENAI_API_KEY);
}
