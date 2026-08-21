import { prisma } from '@land-alpha/db';
import { IngestHttpClient } from '@land-alpha/ingestion';
import { createLogger } from '@land-alpha/shared/logger';

/**
 * The source discovery agent.
 *
 * Semi-automated by design. It searches for the vocabulary that government
 * land-disposition programmes actually use, scores what it finds, and files
 * candidates for human review. Nothing it discovers becomes a production
 * ingestion source without an explicit approval — an automated pipeline that
 * could enrol its own data sources would be a genuinely bad idea.
 */

const logger = createLogger({ component: 'discovery-service' });

/**
 * The terminology that distinguishes a real disposition programme from a
 * general county page. Weighted by how specific each term is to inventory that
 * has already failed to sell, which is what Land Alpha is looking for.
 */
export const DISCOVERY_TERMS: { term: string; weight: number }[] = [
  { term: 'tax forfeited land', weight: 1.0 },
  { term: 'lands available for taxes', weight: 1.0 },
  { term: 'tax title property', weight: 0.9 },
  { term: 're-offer sale', weight: 0.9 },
  { term: 'final tax sale', weight: 0.85 },
  { term: 'no reserve tax foreclosure', weight: 0.95 },
  { term: 'over the counter tax land', weight: 1.0 },
  { term: 'unsold tax foreclosure property', weight: 0.95 },
  { term: 'county surplus property', weight: 0.7 },
  { term: 'municipal surplus real estate', weight: 0.65 },
  { term: 'land bank inventory', weight: 0.7 },
  { term: 'forfeited land sale', weight: 0.9 },
];

export interface DiscoveryCandidate {
  readonly url: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly matchedTerms: string[];
  readonly score: number;
}

export interface DiscoveryOptions {
  readonly state: string;
  readonly county?: string;
  readonly requestedBy: string;
  /**
   * Candidate URLs to evaluate. Supplied by the caller — the agent evaluates
   * pages, it does not operate its own web-scale crawler.
   */
  readonly candidateUrls?: readonly string[];
  readonly http?: IngestHttpClient;
}

/**
 * Evaluate candidate pages for a jurisdiction and file them for review.
 *
 * Scoring is transparent on purpose: the reviewer sees exactly which terms
 * matched and how much each contributed, rather than an opaque relevance number.
 */
export async function discoverSources(options: DiscoveryOptions): Promise<DiscoveryCandidate[]> {
  const http = options.http ?? new IngestHttpClient();
  const urls = options.candidateUrls ?? [];
  const found: DiscoveryCandidate[] = [];

  for (const url of urls) {
    try {
      const response = await http.get(url);
      const html = response.body.toString('utf8');
      const text = stripHtml(html).toLowerCase();
      const title = extractTitle(html) ?? url;

      const matched: string[] = [];
      let score = 0;
      for (const { term, weight } of DISCOVERY_TERMS) {
        if (text.includes(term)) {
          matched.push(term);
          score += weight;
        }
      }

      // A page mentioning a parcel-number format alongside the vocabulary is
      // far more likely to be an actual inventory list than a policy page.
      if (matched.length > 0 && /\b\d{2,4}[-.]\d{3,5}[-.]\d{3,5}\b/.test(text)) {
        score += 0.5;
        matched.push('parcel-number pattern');
      }

      if (matched.length === 0) continue;

      const candidate: DiscoveryCandidate = {
        url,
        title,
        snippet: excerptAround(text, matched[0]!),
        matchedTerms: matched,
        score: Number(score.toFixed(2)),
      };
      found.push(candidate);

      await prisma.sourceDiscoveryCandidate.upsert({
        where: { state_candidateUrl: { state: options.state, candidateUrl: url } },
        create: {
          state: options.state,
          county: options.county ?? null,
          candidateUrl: url,
          title: candidate.title,
          snippet: candidate.snippet,
          matchedTerms: candidate.matchedTerms,
          score: candidate.score,
          status: 'PENDING',
        },
        update: {
          title: candidate.title,
          snippet: candidate.snippet,
          matchedTerms: candidate.matchedTerms,
          score: candidate.score,
        },
      });
    } catch (error) {
      logger.warn('discovery candidate could not be evaluated', {
        url,
        error: String(error).slice(0, 200),
      });
    }
  }

  found.sort((a, b) => b.score - a.score);
  logger.info('discovery complete', {
    state: options.state,
    county: options.county,
    evaluated: urls.length,
    candidates: found.length,
  });
  return found;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match ? match[1]!.trim().slice(0, 200) : null;
}

function excerptAround(text: string, term: string): string | null {
  const index = text.indexOf(term);
  if (index === -1) return null;
  return text.slice(Math.max(0, index - 120), index + 200).trim();
}
