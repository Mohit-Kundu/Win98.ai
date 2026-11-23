import type { ClientLogEntry, LogFields, LogLevel } from '../shared/log';

/**
 * Browser logger. Writes to the browser console and forwards entries to the dev server (POST /api/log),
 * which prints them in the terminal. Never throws and never blocks the caller.
 */
const FLUSH_MS = 250;
const MAX_QUEUE = 100;
const queue: ClientLogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** JSON-safe copy: Errors become name/message, anything unserializable is dropped. */
function plain(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return undefined;
  try {
    return JSON.parse(
      JSON.stringify(fields, (_k, v: unknown) =>
        v instanceof Error ? { name: v.name, message: v.message } : typeof v === 'bigint' ? String(v) : v,
      ),
    ) as LogFields;
  } catch {
    return undefined;
  }
}

function flush(): void {
  timer = undefined;
  if (queue.length === 0) return;
  const entries = queue.splice(0, queue.length);
  try {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* logging must never break the app */
  }
}

function emit(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  if (import.meta.env.MODE === 'test') return;
  const safe = plain(fields);
  console[level === 'debug' ? 'debug' : level](`[${scope}] ${message}`, safe ?? '');
  queue.push({ level, scope, message, ...(safe ? { fields: safe } : {}) });
  if (queue.length > MAX_QUEUE) queue.shift();
  if (level === 'error') flush();
  else timer ??= setTimeout(flush, FLUSH_MS);
}

export interface ClientLogger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function createLogger(scope: string): ClientLogger {
  return {
    debug: (m, f) => emit('debug', scope, m, f),
    info: (m, f) => emit('info', scope, m, f),
    warn: (m, f) => emit('warn', scope, m, f),
    error: (m, f) => emit('error', scope, m, f),
  };
}
