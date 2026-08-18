/**
 * Structured logging. JSON in production so log aggregation works; a compact
 * human line in development. No dependency — this is 60 lines, not a library.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

function currentLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function emit(level: LogLevel, message: string, context: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;
  const record = { ts: new Date().toISOString(), level, msg: message, ...context };
  const line =
    process.env.NODE_ENV === 'production'
      ? JSON.stringify(record)
      : formatHuman(level, message, context);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function formatHuman(level: LogLevel, message: string, context: LogContext): string {
  const keys = Object.keys(context);
  const suffix =
    keys.length === 0 ? '' : ' ' + keys.map((k) => `${k}=${compact(context[k])}`).join(' ');
  return `${level.toUpperCase().padEnd(5)} ${message}${suffix}`;
}

function compact(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return value.includes(' ') ? JSON.stringify(value) : value;
  if (value instanceof Error) return JSON.stringify({ name: value.name, message: value.message });
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 200 ? `${json.slice(0, 197)}...` : json;
  }
  return String(value);
}

export function createLogger(baseContext: LogContext = {}): Logger {
  return {
    debug: (message, context) => emit('debug', message, { ...baseContext, ...context }),
    info: (message, context) => emit('info', message, { ...baseContext, ...context }),
    warn: (message, context) => emit('warn', message, { ...baseContext, ...context }),
    error: (message, context) => emit('error', message, { ...baseContext, ...context }),
    child: (context) => createLogger({ ...baseContext, ...context }),
  };
}

export const logger = createLogger({ app: 'land-alpha' });
