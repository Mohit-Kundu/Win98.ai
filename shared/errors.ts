export type ErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_NAME'
  | 'INVALID_PATH'
  | 'PATH_OUTSIDE_ROOT'
  | 'INVALID_MOVE'
  | 'UNSUPPORTED_TYPE'
  | 'TOO_LARGE'
  | 'CONFLICT_OVERWRITE'
  | 'WRITE_FAILED'
  | 'VALIDATION'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_FAILED'
  | 'LIMIT_REACHED'
  | 'DECLINED'
  | 'UNKNOWN_TOOL';

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (code: ErrorCode, message: string, details?: unknown): Result<never> => ({
  ok: false,
  error: details === undefined ? { code, message } : { code, message, details },
});
