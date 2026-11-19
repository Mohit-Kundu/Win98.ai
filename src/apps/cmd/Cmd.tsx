import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { executeCommand } from '../../actions';
import type { AppProps } from '../../desktop/appRegistry';
import { useContextProvider } from '../../ai/context';
import { clearCmdState, getCmdSnapshot, getNaturalLanguageHandler, setCmdState } from './context';
import { LineEditor } from './lineEditor';
import { createNaturalLanguageHandler } from './naturalLanguage';
import { formatPrompt } from './state';

const ROOT = 'C:\\';
const defaultNlHandler = createNaturalLanguageHandler();

export function Cmd({ windowId }: AppProps) {
  useContextProvider('cmd', windowId, () => {
    const s = getCmdSnapshot(windowId);
    return s ? { app: 'cmd', cwd: s.cwd } : undefined;
  });
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Courier New", monospace',
      fontSize: 14,
      theme: { background: '#000000', foreground: '#c0c0c0' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const doFit = () => {
      try {
        fit.fit();
      } catch {
        /* container not measurable yet */
      }
    };
    doFit();
    const ro = new ResizeObserver(doFit);
    ro.observe(el);

    let cwd = ROOT;
    let nlMode = false;
    let busy = false;
    let lastOutput: string[] = [];
    let disposed = false;
    let aiAbort: AbortController | undefined;
    const editor = new LineEditor(formatPrompt(cwd));
    const pending: string[] = [];

    const writeLines = (lines: string[]) => {
      for (const l of lines) term.write(l + '\r\n');
    };
    const showPrompt = () => {
      editor.setPrompt(formatPrompt(cwd));
      term.write(formatPrompt(cwd));
      setCmdState(windowId, cwd, lastOutput);
    };

    const run = async (line: string) => {
      let lines: string[];
      const r = await executeCommand({ line, cwd, nlMode });
      if (disposed) return;
      if (!r.ok) {
        lines = [r.error.message];
      } else {
        cwd = r.value.cwd;
        if (r.value.nlMode !== undefined) nlMode = r.value.nlMode;
        if (r.value.clear) term.clear();
        lines = r.value.output;
        if (r.value.aiInstruction !== undefined) {
          const handler = getNaturalLanguageHandler() ?? defaultNlHandler;
          const controller = new AbortController();
          aiAbort = controller;
          try {
            lines = await handler(r.value.aiInstruction, {
              windowId,
              cwd,
              signal: controller.signal,
              print: (l) => {
                if (!disposed) term.write(l + '\r\n');
              },
            });
          } catch {
            lines = ['The AI assistant failed to complete the request.'];
          } finally {
            aiAbort = undefined;
          }
          if (disposed) return;
        }
      }
      if (lines.length > 0) lastOutput = lines;
      writeLines(lines);
    };

    const drain = async () => {
      if (busy) return;
      busy = true;
      while (pending.length > 0 && !disposed) {
        await run(pending.shift() as string);
        if (!disposed) showPrompt();
      }
      busy = false;
    };

    const sub = term.onData((data) => {
      if (aiAbort) {
        // Input is blocked while the assistant works. Ctrl+C cancels the run.
        if (data.includes('\x03')) aiAbort.abort();
        return;
      }
      const { output, submitted } = editor.feed(data);
      term.write(output);
      if (submitted.length > 0) {
        pending.push(...submitted);
        void drain();
      }
    });

    term.write('Win98 AI [Version 1.0]\r\nType HELP for a list of commands.\r\n\r\n');
    showPrompt();
    term.focus();

    return () => {
      disposed = true;
      sub.dispose();
      ro.disconnect();
      clearCmdState(windowId);
      term.dispose();
    };
  }, [windowId]);

  return <div ref={host} style={{ width: '100%', height: '100%', background: '#000', overflow: 'hidden' }} />;
}
