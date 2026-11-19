/**
 * Split a command line into tokens. Double quotes group text (including spaces).
 * Backslashes are literal (paths use them) except directly before a double quote,
 * where the Windows rule applies: 2n backslashes + quote -> n backslashes, quote toggles;
 * 2n+1 backslashes + quote -> n backslashes and a literal quote.
 * An unterminated quote runs to the end of the line.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (ch === '\\') {
      let n = 0;
      while (line.charAt(i + n) === '\\') n++;
      if (line.charAt(i + n) === '"') {
        cur += '\\'.repeat(Math.floor(n / 2));
        has = true;
        if (n % 2 === 1) {
          cur += '"';
        } else {
          inQuotes = !inQuotes;
        }
        i += n + 1;
      } else {
        cur += '\\'.repeat(n);
        has = true;
        i += n;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      has = true;
      i++;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
      i++;
      continue;
    }
    cur += ch;
    has = true;
    i++;
  }
  if (has) tokens.push(cur);
  return tokens;
}

/** Quote one argument so that `tokenize` returns it unchanged. */
export function quoteArg(arg: string): string {
  let out = '"';
  let i = 0;
  while (i < arg.length) {
    let n = 0;
    while (arg.charAt(i + n) === '\\') n++;
    if (n > 0 && (i + n === arg.length || arg.charAt(i + n) === '"')) {
      // backslashes before a quote (or the closing quote) must be doubled
      out += '\\'.repeat(n * 2);
      if (i + n < arg.length) out += '\\"';
      i += n + (i + n < arg.length ? 1 : 0);
    } else if (n > 0) {
      out += '\\'.repeat(n);
      i += n;
    } else if (arg.charAt(i) === '"') {
      out += '\\"';
      i++;
    } else {
      out += arg.charAt(i);
      i++;
    }
  }
  return out + '"';
}

export function joinArgs(args: readonly string[]): string {
  return args.map(quoteArg).join(' ');
}
