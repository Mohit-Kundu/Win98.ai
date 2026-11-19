import { err, ok, type Result } from '../../shared/errors';

export const ROOT_DISPLAY = 'C:\\';
export const MAX_NAME_LENGTH = 255;

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/;

/** Case-insensitive comparison key for a node name. */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

export function validateName(name: string): Result<string> {
  if (name.length === 0 || name.trim().length === 0) {
    return err('INVALID_NAME', 'A file name cannot be empty.');
  }
  if (name.length > MAX_NAME_LENGTH) {
    return err('INVALID_NAME', `A file name cannot be longer than ${MAX_NAME_LENGTH} characters.`);
  }
  if (INVALID_NAME_CHARS.test(name) || CONTROL_CHARS.test(name)) {
    return err('INVALID_NAME', 'A file name cannot contain any of the following characters: \\ / : * ? " < > |');
  }
  if (name === '.' || name === '..') {
    return err('INVALID_NAME', `"${name}" is not a valid file name.`);
  }
  return ok(name);
}

/** Lowercase extension without the dot, or undefined if none. */
export function extOf(name: string): string | undefined {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return undefined;
  return name.slice(i + 1).toLowerCase();
}

/**
 * Turn a path into the list of segments from the VFS root.
 * Accepts `\` and `/`, an optional `C:` prefix, `.` and `..`.
 * Absolute paths (leading separator or `C:`) start at the root; others start at `cwdSegments`.
 * Climbing above the root returns PATH_OUTSIDE_ROOT.
 */
export function resolveSegments(path: string, cwdSegments: readonly string[] = []): Result<string[]> {
  if (typeof path !== 'string' || CONTROL_CHARS.test(path)) {
    return err('INVALID_PATH', 'The path is not valid.', { path });
  }
  let rest = path.trim();
  let out: string[];
  const drive = /^[a-zA-Z]:/.exec(rest);
  if (drive) {
    if (drive[0].toUpperCase() !== 'C:') {
      return err('INVALID_PATH', `The drive "${drive[0]}" does not exist.`, { path });
    }
    rest = rest.slice(2);
    // `C:foo` is treated as absolute for simplicity.
    out = [];
  } else if (/^[\\/]/.test(rest)) {
    out = [];
  } else {
    out = [...cwdSegments];
  }
  for (const seg of rest.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) {
        return err('PATH_OUTSIDE_ROOT', 'The path resolves outside the root of the drive.', { path });
      }
      out.pop();
      continue;
    }
    const v = validateName(seg);
    if (!v.ok) return err('INVALID_PATH', v.error.message, { path, segment: seg });
    out.push(seg);
  }
  return ok(out);
}

/** Display path for a list of segments, e.g. `C:\My Documents\a.txt`. */
export function formatPath(segments: readonly string[]): string {
  return segments.length === 0 ? ROOT_DISPLAY : `C:\\${segments.join('\\')}`;
}
