/** Shared log types and the one-line formatter used by the server terminal output. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

/** One client log entry as sent to POST /api/log. */
export interface ClientLogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  fields?: LogFields;
}

/** Collapses control characters (so one entry is always one line) and caps the length. */
export function oneLine(text: string, max = 200): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

/** Name and HTTP status of an error. Never the message, which may contain URLs or keys. */
export function errorSummary(e: unknown): string {
  if (!(e instanceof Error)) return 'error';
  const status = (e as { status?: unknown }).status;
  return typeof status === 'number' ? `${e.name} ${status}` : e.name;
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(oneLine(v));
  if (v instanceof Error) return JSON.stringify(errorSummary(v));
  try {
    return oneLine(JSON.stringify(v) ?? String(v));
  } catch {
    return '[unserializable]';
  }
}

export function formatLine(now: Date, level: LogLevel, scope: string, message: string, fields?: LogFields): string {
  const time = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const tail = fields
    ? Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(' ')
    : '';
  return `${time} ${level.toUpperCase().padEnd(5)} [${oneLine(scope, 40)}] ${oneLine(message, 300)}${tail ? ' ' + tail : ''}`;
}
