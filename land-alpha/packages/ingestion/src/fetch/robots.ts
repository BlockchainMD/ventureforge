/**
 * robots.txt evaluation.
 *
 * Land Alpha respects robots.txt as a matter of policy, not convenience. A
 * disallowed path is not fetched, and the source is flagged for manual handling
 * rather than routed around. See docs/decisions/0006.
 *
 * Implements the subset of the Robots Exclusion Protocol that matters for a
 * well-behaved crawler: User-agent grouping with the most-specific match,
 * Allow/Disallow with longest-match-wins precedence, `*` and `$` wildcards, and
 * Crawl-delay.
 */

export interface RobotsRule {
  readonly allow: boolean;
  readonly pattern: string;
}

export interface RobotsGroup {
  readonly agents: string[];
  readonly rules: RobotsRule[];
  readonly crawlDelaySeconds: number | null;
}

export interface RobotsTxt {
  readonly groups: RobotsGroup[];
  readonly sitemaps: string[];
  /** True when robots.txt was absent (404) — everything is then permitted. */
  readonly absent: boolean;
}

export const PERMISSIVE_ROBOTS: RobotsTxt = { groups: [], sitemaps: [], absent: true };

export function parseRobotsTxt(body: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let currentAgents: string[] = [];
  let currentRules: RobotsRule[] = [];
  let currentDelay: number | null = null;
  let expectingAgents = true;

  const flush = (): void => {
    if (currentAgents.length > 0) {
      groups.push({
        agents: currentAgents,
        rules: currentRules,
        crawlDelaySeconds: currentDelay,
      });
    }
    currentAgents = [];
    currentRules = [];
    currentDelay = null;
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case 'user-agent':
        // A new user-agent line after rules starts a new group.
        if (!expectingAgents) flush();
        currentAgents.push(value.toLowerCase());
        expectingAgents = true;
        break;
      case 'allow':
        if (value) currentRules.push({ allow: true, pattern: value });
        expectingAgents = false;
        break;
      case 'disallow':
        // An empty Disallow means "allow everything" and carries no rule.
        if (value) currentRules.push({ allow: false, pattern: value });
        expectingAgents = false;
        break;
      case 'crawl-delay': {
        const delay = Number.parseFloat(value);
        if (Number.isFinite(delay)) currentDelay = delay;
        expectingAgents = false;
        break;
      }
      case 'sitemap':
        if (value) sitemaps.push(value);
        break;
      default:
        break;
    }
  }
  flush();

  return { groups, sitemaps, absent: false };
}

/** Select the group that applies to our user agent: exact match beats `*`. */
export function groupFor(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const token = userAgentToken(userAgent);
  let wildcard: RobotsGroup | null = null;
  let best: RobotsGroup | null = null;
  let bestLength = -1;

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        wildcard ??= group;
        continue;
      }
      if (token.startsWith(agent) && agent.length > bestLength) {
        best = group;
        bestLength = agent.length;
      }
    }
  }
  return best ?? wildcard;
}

export function isAllowed(robots: RobotsTxt, userAgent: string, path: string): boolean {
  if (robots.absent) return true;
  const group = groupFor(robots, userAgent);
  if (!group || group.rules.length === 0) return true;

  let decision = true;
  let bestSpecificity = -1;

  for (const rule of group.rules) {
    const matched = matchPattern(rule.pattern, path);
    if (matched == null) continue;
    // Longest matching pattern wins; Allow wins ties (RFC 9309).
    if (matched > bestSpecificity || (matched === bestSpecificity && rule.allow)) {
      bestSpecificity = matched;
      decision = rule.allow;
    }
  }
  return decision;
}

export function crawlDelayMs(robots: RobotsTxt, userAgent: string): number | null {
  const group = groupFor(robots, userAgent);
  return group?.crawlDelaySeconds != null ? group.crawlDelaySeconds * 1000 : null;
}

/**
 * Match a robots path pattern against a URL path.
 * Returns the pattern's length (its specificity) when it matches, else null.
 */
function matchPattern(pattern: string, path: string): number | null {
  const anchoredEnd = pattern.endsWith('$');
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const segments = body.split('*');

  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment === '') continue;
    if (i === 0) {
      if (!path.startsWith(segment)) return null;
      cursor = segment.length;
    } else {
      const found = path.indexOf(segment, cursor);
      if (found === -1) return null;
      cursor = found + segment.length;
    }
  }

  if (anchoredEnd && cursor !== path.length) {
    // With a trailing wildcard before `$`, any remainder is acceptable only if
    // the last segment truly ends the path.
    const lastSegment = segments[segments.length - 1]!;
    if (lastSegment !== '' && !path.endsWith(lastSegment)) return null;
    if (lastSegment === '') return body.length;
    if (!path.endsWith(lastSegment)) return null;
  }

  return body.length;
}

function userAgentToken(userAgent: string): string {
  return userAgent.split('/')[0]!.trim().toLowerCase();
}
