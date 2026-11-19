import { historyReducer, historyText, initialHistory, type HistoryState } from './state';

export interface FeedResult {
  /** Text to write to the terminal (already includes line endings and escape codes). */
  output: string;
  /** Lines submitted with Enter, in order. */
  submitted: string[];
}

/**
 * Pure line editor for xterm: the terminal has no line discipline, so this keeps the buffer,
 * handles backspace, Enter, Ctrl+C, and Up/Down history. The cursor is always at the end of the line.
 */
export class LineEditor {
  private buf = '';
  private history: HistoryState = initialHistory;
  private prompt: string;

  constructor(prompt = '') {
    this.prompt = prompt;
  }

  get buffer(): string {
    return this.buf;
  }

  get historyEntries(): readonly string[] {
    return this.history.entries;
  }

  setPrompt(prompt: string): void {
    this.prompt = prompt;
  }

  private redraw(): string {
    return `\r\x1b[K${this.prompt}${this.buf}`;
  }

  feed(data: string): FeedResult {
    let output = '';
    const submitted: string[] = [];
    for (let i = 0; i < data.length; i++) {
      const ch = data[i] as string;
      if (ch === '\x1b') {
        // Arrow keys arrive as ESC [ A / ESC [ B. Skip any other escape sequence.
        if (data[i + 1] === '[') {
          const final = data[i + 2];
          i += 2;
          if (final === 'A' || final === 'B') {
            this.history = historyReducer(this.history, { type: final === 'A' ? 'up' : 'down' });
            this.buf = historyText(this.history);
            output += this.redraw();
          }
        }
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\n' && data[i - 1] === '\r') continue;
        const line = this.buf;
        this.buf = '';
        this.history = historyReducer(this.history, { type: 'push', line });
        submitted.push(line);
        output += '\r\n';
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.buf.length > 0) {
          this.buf = this.buf.slice(0, -1);
          output += '\b \b';
        }
      } else if (ch === '\x03') {
        this.buf = '';
        this.history = { ...this.history, cursor: this.history.entries.length };
        output += '^C\r\n' + this.prompt;
      } else if (ch >= ' ') {
        this.buf += ch;
        output += ch;
      }
    }
    return { output, submitted };
  }
}
