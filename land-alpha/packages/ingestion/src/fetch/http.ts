import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AccessRestrictedError, NetworkError, RateLimitedError } from '@land-alpha/shared';
import { sleep, withRetry } from '@land-alpha/shared/retry';
import { env } from '@land-alpha/shared/env';
import { createLogger } from '@land-alpha/shared/logger';
import { contentHash } from '@land-alpha/shared/ids';
import {
  isAllowed,
  crawlDelayMs,
  parseRobotsTxt,
  PERMISSIVE_ROBOTS,
  type RobotsTxt,
} from './robots';

/**
 * The ingestion HTTP client.
 *
 * This is the only way Land Alpha talks to a government server, and it is
 * deliberately conservative. It identifies itself, obeys robots.txt, rate-limits
 * per host, backs off on 429/503, caps total requests per run, and accounts for
 * every byte it pulls.
 *
 * It has no capability to solve a CAPTCHA, authenticate against a protected
 * system, or evade a technical access control — and adding one is out of scope
 * by policy, not by omission. When a server responds with a challenge, the
 * client raises `AccessRestrictedError`, which flips the source to MANUAL_ONLY
 * and routes it to the analyst import workflow instead.
 */

const logger = createLogger({ component: 'ingest-http' });

export interface FetchStats {
  requestCount: number;
  bytesFetched: number;
  hostsContacted: Set<string>;
}

export interface HttpResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly body: Buffer;
  readonly sha256: string;
  readonly fetchedAt: Date;
}

export interface HttpClientOptions {
  readonly userAgent?: string;
  readonly minDelayMs?: number;
  readonly timeoutMs?: number;
  readonly maxRequests?: number;
  readonly respectRobots?: boolean;
  /** Read from `data/fixtures/raw/<slug>` instead of the network. */
  readonly offline?: boolean;
  readonly offlineDir?: string;
  readonly signal?: AbortSignal;
  /**
   * Consecutive failures against one host before the client stops calling it
   * for the rest of the run. Zero disables the breaker.
   */
  readonly hostFailureLimit?: number;
  /** Attempts per request, including the first. Default 3. */
  readonly retryAttempts?: number;
}

/** Bodies matching these are challenge pages, not data. */
const CHALLENGE_MARKERS: { pattern: RegExp; kind: AccessRestrictedError['restriction'] }[] = [
  { pattern: /sgcaptcha|\/\.well-known\/captcha|hcaptcha|recaptcha|g-recaptcha/i, kind: 'CAPTCHA' },
  {
    pattern: /cf-browser-verification|cf_chl_opt|__cf_chl_|Checking your browser before/i,
    kind: 'CAPTCHA',
  },
  { pattern: /Incapsula incident ID|_Incapsula_Resource/i, kind: 'BLOCKED' },
  { pattern: /Request unsuccessful\. Bot Manager/i, kind: 'BLOCKED' },
];

export class IngestHttpClient {
  private readonly userAgent: string;
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRequests: number;
  private readonly respectRobots: boolean;
  private readonly offline: boolean;
  private readonly offlineDir: string;
  private readonly signal: AbortSignal | undefined;

  private readonly robotsCache = new Map<string, Promise<RobotsTxt>>();
  private readonly lastRequestAt = new Map<string, number>();

  /**
   * Circuit breaker.
   *
   * An enrichment run touches one host once per parcel. When that host is down
   * — or is a WAF returning 500 to our User-Agent, which it will do for every
   * parcel equally — three attempts with exponential backoff per parcel turns a
   * five-minute run into an hour of waiting for the same answer 300 times.
   *
   * After `hostFailureLimit` consecutive failures the host is cut off for the
   * rest of the run and every later call fails instantly with the reason the
   * first one gave. That reason reaches the enrichment layer as a named
   * unknown, so the run is both fast and honest about what it skipped. A single
   * success resets the count: this is a breaker, not a blocklist.
   */
  private readonly hostFailures = new Map<string, { count: number; lastError: string }>();
  private readonly hostFailureLimit: number;
  private readonly retryAttempts: number;

  readonly stats: FetchStats = {
    requestCount: 0,
    bytesFetched: 0,
    hostsContacted: new Set<string>(),
  };

  constructor(options: HttpClientOptions = {}) {
    const config = env();
    this.userAgent = options.userAgent ?? config.INGEST_USER_AGENT;
    this.minDelayMs = options.minDelayMs ?? config.INGEST_MIN_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? config.INGEST_TIMEOUT_MS;
    this.maxRequests = options.maxRequests ?? config.INGEST_MAX_REQUESTS_PER_RUN;
    this.respectRobots = options.respectRobots ?? config.INGEST_RESPECT_ROBOTS;
    this.offline = options.offline ?? config.INGEST_OFFLINE;
    this.offlineDir = options.offlineDir ?? 'data/fixtures/raw';
    this.signal = options.signal;
    this.hostFailureLimit = options.hostFailureLimit ?? 3;
    this.retryAttempts = Math.max(1, options.retryAttempts ?? 3);
  }

  /**
   * `options.timeoutMs` raises the per-request deadline for a bulk download.
   * The default suits an API response; a county parcel archive is a quarter of
   * a gigabyte and will not arrive inside it.
   */
  async get(
    url: string,
    headers: Record<string, string> = {},
    options: { timeoutMs?: number } = {},
  ): Promise<HttpResponse> {
    if (this.offline) return this.readOffline(url);

    if (this.stats.requestCount >= this.maxRequests) {
      throw new NetworkError(
        `Ingestion request cap of ${this.maxRequests} reached; refusing to continue.`,
        { url, cap: this.maxRequests },
      );
    }

    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new NetworkError(`Unsupported protocol: ${parsed.protocol}`, { url });
    }

    if (this.respectRobots) {
      const robots = await this.robotsFor(parsed);
      if (!isAllowed(robots, this.userAgent, parsed.pathname + parsed.search)) {
        throw new AccessRestrictedError(
          `robots.txt disallows ${parsed.pathname} for ${this.userAgent}. This source must be handled manually.`,
          'ROBOTS',
          { url },
        );
      }
      const declaredDelay = crawlDelayMs(robots, this.userAgent);
      if (declaredDelay != null) {
        await this.throttle(parsed.host, Math.max(declaredDelay, this.minDelayMs));
      } else {
        await this.throttle(parsed.host, this.minDelayMs);
      }
    } else {
      await this.throttle(parsed.host, this.minDelayMs);
    }

    const tripped = this.breakerFor(parsed.host);
    if (tripped) {
      throw new NetworkError(
        `${parsed.host} has failed ${this.hostFailureLimit} consecutive requests this run and is not being called again. First failure: ${tripped}`,
        { url: truncateUrl(url), host: parsed.host, circuitOpen: true },
      );
    }

    try {
      const response = await withRetry(() => this.performGet(url, headers, options.timeoutMs), {
        attempts: this.retryAttempts,
        onRetry: (error, attempt, delayMs) =>
          // Query strings on ArcGIS requests run to thousands of characters;
          // logging them whole makes the log unreadable and hides the failure.
          logger.warn('retrying request', {
            url: truncateUrl(url),
            attempt,
            delayMs,
            error: truncateUrl(String(error), 300),
          }),
        signal: this.signal,
      });
      this.hostFailures.delete(parsed.host);
      return response;
    } catch (error) {
      this.recordHostFailure(parsed.host, error);
      throw error;
    }
  }

  /** The reason a host is cut off, or null while it is still being called. */
  private breakerFor(host: string): string | null {
    if (this.hostFailureLimit <= 0) return null;
    const state = this.hostFailures.get(host);
    if (!state || state.count < this.hostFailureLimit) return null;
    return state.lastError;
  }

  private recordHostFailure(host: string, error: unknown): void {
    const existing = this.hostFailures.get(host);
    const count = (existing?.count ?? 0) + 1;
    // The *first* failure's message is kept. It is the one that explains the
    // cause; later ones are all the same and the last is the least informative.
    const lastError = existing?.lastError ?? truncateUrl(String(error), 300);
    this.hostFailures.set(host, { count, lastError });
    if (count === this.hostFailureLimit) {
      logger.warn('host cut off for this run', { host, failures: count, error: lastError });
    }
  }

  async getJson<T>(url: string): Promise<T> {
    const response = await this.get(url, { Accept: 'application/json' });
    const text = response.body.toString('utf8');
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new NetworkError(
        'Response was not valid JSON',
        { url, preview: text.slice(0, 200) },
        cause,
      );
    }
  }

  private async performGet(
    url: string,
    headers: Record<string, string>,
    timeoutMs?: number,
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    this.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
          ...headers,
        },
      });

      this.stats.requestCount += 1;
      this.stats.hostsContacted.add(new URL(url).host);

      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        throw new RateLimitedError(
          `Server asked us to slow down (HTTP ${response.status})`,
          retryAfter,
          { url },
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new AccessRestrictedError(
          `Server refused access (HTTP ${response.status}). Not circumventing; source must be handled manually.`,
          response.status === 401 ? 'AUTHENTICATION' : 'BLOCKED',
          { url },
        );
      }
      if (!response.ok) {
        throw new NetworkError(`HTTP ${response.status} from ${truncateUrl(url)}`, {
          url: truncateUrl(url),
          status: response.status,
        });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      this.stats.bytesFetched += buffer.byteLength;

      const contentType = response.headers.get('content-type');
      assertNotAChallengePage(url, contentType, buffer);

      return {
        url: response.url || url,
        status: response.status,
        contentType,
        body: buffer,
        sha256: contentHash(buffer),
        fetchedAt: new Date(),
      };
    } catch (error) {
      if (error instanceof RateLimitedError || error instanceof AccessRestrictedError) throw error;
      if (error instanceof NetworkError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError(`Request timed out after ${this.timeoutMs}ms`, { url });
      }
      throw new NetworkError(`Request failed: ${String(error)}`, { url }, error);
    } finally {
      clearTimeout(timer);
    }
  }

  private async throttle(host: string, delayMs: number): Promise<void> {
    const last = this.lastRequestAt.get(host);
    if (last != null) {
      const elapsed = Date.now() - last;
      if (elapsed < delayMs) await sleep(delayMs - elapsed, this.signal);
    }
    this.lastRequestAt.set(host, Date.now());
  }

  private robotsFor(url: URL): Promise<RobotsTxt> {
    const key = url.origin;
    const cached = this.robotsCache.get(key);
    if (cached) return cached;

    const promise = (async (): Promise<RobotsTxt> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 15_000));
        try {
          const response = await fetch(`${url.origin}/robots.txt`, {
            headers: { 'User-Agent': this.userAgent },
            signal: controller.signal,
          });
          this.stats.requestCount += 1;
          // 404 means no policy was published, which permits everything.
          if (response.status === 404 || response.status === 410) return PERMISSIVE_ROBOTS;
          if (!response.ok) return PERMISSIVE_ROBOTS;
          const text = await response.text();
          // Some hosts serve an HTML challenge in place of robots.txt.
          if (/^\s*</.test(text)) return PERMISSIVE_ROBOTS;
          return parseRobotsTxt(text);
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // A robots.txt we cannot read is treated as permissive, matching
        // established crawler behaviour; per-host rate limiting still applies.
        return PERMISSIVE_ROBOTS;
      }
    })();

    this.robotsCache.set(key, promise);
    return promise;
  }

  /**
   * Offline mode. `INGEST_OFFLINE=true` makes every adapter read a recorded
   * fixture instead of the network, which is what makes adapter regression
   * tests possible and what lets the whole product run with no internet.
   */
  private async readOffline(url: string): Promise<HttpResponse> {
    const filename = offlineFilename(url);
    const path = join(process.cwd(), this.offlineDir, filename);
    try {
      const body = await readFile(path);
      this.stats.requestCount += 1;
      this.stats.bytesFetched += body.byteLength;
      return {
        url,
        status: 200,
        contentType: guessContentType(filename),
        body,
        sha256: contentHash(body),
        fetchedAt: new Date(),
      };
    } catch {
      throw new NetworkError(
        `Offline mode is on but no fixture exists at ${path}. Record one, or unset INGEST_OFFLINE.`,
        { url, path },
      );
    }
  }
}

/** Deterministic fixture filename for a URL, so recordings are reproducible. */
export function offlineFilename(url: string): string {
  const parsed = new URL(url);
  const slug = `${parsed.host}${parsed.pathname}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  const query = parsed.search ? `_${contentHash(parsed.search).slice(0, 10)}` : '';
  return `${slug}${query}.bin`;
}

function guessContentType(filename: string): string | null {
  if (filename.endsWith('.json.bin') || filename.includes('f_json')) return 'application/json';
  return null;
}

/** Keep a long query string from swamping a log line. */
export function truncateUrl(url: string, maxLength = 160): string {
  if (url.length <= maxLength) return url;
  return `${url.slice(0, maxLength)}… (+${url.length - maxLength} chars)`;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Detect a bot-challenge page served with HTTP 200.
 *
 * This is the case that matters most: a server that answers 200 with a CAPTCHA
 * interstitial. Parsing that as data produces silent garbage, so it is raised
 * as an access restriction and the source is taken out of automated ingestion.
 */
export function assertNotAChallengePage(
  url: string,
  contentType: string | null,
  body: Buffer,
): void {
  if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return;
  const preview = body.subarray(0, 4000).toString('utf8');
  for (const marker of CHALLENGE_MARKERS) {
    if (marker.pattern.test(preview)) {
      throw new AccessRestrictedError(
        `Server returned a bot-challenge page. Land Alpha does not circumvent access controls; register this source as MANUAL_SOURCE.`,
        marker.kind,
        { url },
      );
    }
  }
}
