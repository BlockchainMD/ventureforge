/** Typed error hierarchy. Ingestion failures must be classifiable, not stringly-typed. */

export type ErrorCategory =
  | 'CONFIGURATION'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'ACCESS_RESTRICTED'
  | 'PARSE'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'AUTHORIZATION'
  | 'UPSTREAM'
  | 'INTERNAL';

export class LandAlphaError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      category?: ErrorCategory;
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.category = options.category ?? 'INTERNAL';
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
  }
}

export class ConfigurationError extends LandAlphaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { category: 'CONFIGURATION', retryable: false, context });
  }
}

export class NetworkError extends LandAlphaError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { category: 'NETWORK', retryable: true, context, cause });
  }
}

export class RateLimitedError extends LandAlphaError {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null, context?: Record<string, unknown>) {
    super(message, { category: 'RATE_LIMITED', retryable: true, context });
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Raised when a source is behind a control we will not circumvent: robots
 * disallow, a CAPTCHA, a login wall, a paywall. This is never retried and
 * never worked around — it flips the source to MANUAL_ONLY.
 */
export class AccessRestrictedError extends LandAlphaError {
  readonly restriction: 'ROBOTS' | 'CAPTCHA' | 'AUTHENTICATION' | 'PAYWALL' | 'BLOCKED';
  constructor(
    message: string,
    restriction: AccessRestrictedError['restriction'],
    context?: Record<string, unknown>,
  ) {
    super(message, { category: 'ACCESS_RESTRICTED', retryable: false, context });
    this.restriction = restriction;
  }
}

export class ParseError extends LandAlphaError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { category: 'PARSE', retryable: false, context, cause });
  }
}

export class ValidationError extends LandAlphaError {
  readonly issues: readonly string[];
  constructor(message: string, issues: readonly string[] = [], context?: Record<string, unknown>) {
    super(message, { category: 'VALIDATION', retryable: false, context });
    this.issues = issues;
  }
}

export class NotFoundError extends LandAlphaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { category: 'NOT_FOUND', retryable: false, context });
  }
}

export class AuthorizationError extends LandAlphaError {
  constructor(message = 'Not authorized', context?: Record<string, unknown>) {
    super(message, { category: 'AUTHORIZATION', retryable: false, context });
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof LandAlphaError && error.retryable;
}

export function errorToRecord(error: unknown): {
  name: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
  context: Record<string, unknown>;
  stack?: string;
} {
  if (error instanceof LandAlphaError) {
    return {
      name: error.name,
      message: error.message,
      category: error.category,
      retryable: error.retryable,
      context: error.context,
      stack: error.stack,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      category: 'INTERNAL',
      retryable: false,
      context: {},
      stack: error.stack,
    };
  }
  return {
    name: 'UnknownError',
    message: String(error),
    category: 'INTERNAL',
    retryable: false,
    context: {},
  };
}
