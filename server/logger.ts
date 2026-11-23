import { formatLine } from '../shared/log.js';
import type { LogFields, LogLevel } from '../shared/log.js';

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** LOG_LEVEL=debug|info|warn|error|silent. Defaults to info, and to silent under vitest. */
function threshold(): number {
  const v = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (v === 'silent') return Infinity;
  if (v && v in RANK) return RANK[v as LogLevel];
  return process.env.VITEST ? Infinity : RANK.info;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Writes one line per entry to the terminal: stdout for debug/info, stderr for warn/error. */
export function writeLog(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  if (RANK[level] < threshold()) return;
  const line = formatLine(new Date(), level, scope, message, fields);
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, f) => writeLog('debug', scope, m, f),
    info: (m, f) => writeLog('info', scope, m, f),
    warn: (m, f) => writeLog('warn', scope, m, f),
    error: (m, f) => writeLog('error', scope, m, f),
  };
}
