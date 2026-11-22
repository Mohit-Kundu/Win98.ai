import { useEffect, useRef, useState, type FormEvent } from 'react';
import { requestAiConfirmation } from '../../ai/confirm';
import { buildAiContext } from '../../ai/context';
import { runOrchestrator } from '../../ai/orchestrator';
import type { OrchestratorResult, OrchestratorRun, OrchestratorStep, RunEvent } from '../../ai/types';
import { ClippyAgent } from './ClippyAgent';
import { nextChatId, priorTurns, useChatStore, type StepLine } from './chatStore';
import './clippy.css';

export interface ClippyDeps {
  run: (run: OrchestratorRun) => Promise<OrchestratorResult>;
  confirm: OrchestratorRun['confirm'];
  buildContext: typeof buildAiContext;
}

const defaultDeps: ClippyDeps = {
  run: (r) => runOrchestrator(r),
  confirm: requestAiConfirmation,
  buildContext: buildAiContext,
};

const SPEAK_MS = 3000;

function shorten(text: string, max = 100): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 3) + '...' : one;
}

/** Status line derived from the real tool result of a finished step. */
export function stepToLine(id: number, step: OrchestratorStep): StepLine {
  if (step.status === 'ok') {
    const v = step.result.ok ? (step.result.value as Record<string, unknown> | null) : null;
    const path = v && typeof v === 'object' && typeof v['path'] === 'string' ? v['path'] : undefined;
    return { id, tool: step.tool, status: 'ok', ...(path ? { detail: path } : {}) };
  }
  if (step.status === 'declined') return { id, tool: step.tool, status: 'declined' };
  const detail = !step.result.ok ? shorten(`${step.result.error.code}: ${step.result.error.message}`) : 'failed';
  return { id, tool: step.tool, status: 'failed', detail };
}

const LABEL: Record<StepLine['status'], string> = { running: 'running', ok: 'ok', failed: 'failed', declined: 'declined' };

/**
 * Floating Clippy: the agent character plus a small chat panel. The panel is a plain fixed-position
 * element, not a managed window, so using it never changes the focused app window. The context is read
 * from the focused app window at send time.
 */
export function Clippy({ deps }: { deps?: Partial<ClippyDeps> }) {
  const d = { ...defaultDeps, ...deps };
  const open = useChatStore((s) => s.open);
  const phase = useChatStore((s) => s.phase);
  const reaction = useChatStore((s) => s.reaction);
  const running = useChatStore((s) => s.running);
  const messages = useChatStore((s) => s.messages);
  const liveSteps = useChatStore((s) => s.liveSteps);
  const [text, setText] = useState('');
  const [agentStatus, setAgentStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const abortRef = useRef<AbortController | null>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const logRef = useRef<HTMLDivElement>(null);
  const depsRef = useRef(d);
  depsRef.current = d;

  useEffect(
    () => () => {
      clearTimeout(speakTimer.current);
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, liveSteps]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const userText = text.trim();
    const store = useChatStore.getState();
    if (!userText || store.running) return;
    setText('');
    clearTimeout(speakTimer.current);

    // Capture the context now, from the focused app window (the chat is not a window).
    const context = depsRef.current.buildContext();
    const history = priorTurns(store.messages);
    store.addMessage({ role: 'user', text: userText });
    store.setLiveSteps(() => []);
    store.setRunning(true);
    store.setPhase('thinking');

    const controller = new AbortController();
    abortRef.current = controller;
    const lines: StepLine[] = [];
    let pendingId = 0;
    const onEvent = (ev: RunEvent) => {
      const s = useChatStore.getState();
      if (ev.type === 'thinking') s.setPhase('thinking');
      else if (ev.type === 'tool_start') {
        pendingId = nextChatId();
        const line: StepLine = { id: pendingId, tool: ev.tool, status: 'running' };
        lines.push(line);
        s.setLiveSteps((cur) => [...cur, line]);
      } else if (ev.type === 'tool_end') {
        const done = stepToLine(pendingId, ev.step);
        const idx = lines.findIndex((l) => l.id === pendingId);
        if (idx >= 0) lines[idx] = done;
        if (done.status === 'failed' || done.status === 'declined') s.react('Alert');
        s.setLiveSteps((cur) => cur.map((l) => (l.id === pendingId ? done : l)));
      }
    };

    let result: OrchestratorResult | undefined;
    try {
      result = await depsRef.current.run({
        userText,
        context,
        history,
        confirm: depsRef.current.confirm,
        onEvent,
        signal: controller.signal,
      });
    } catch (err) {
      result = {
        finalText: '',
        report: `Stopped because of an error (${err instanceof Error ? err.message : 'unexpected error'}).`,
        steps: [],
        stoppedBy: 'error',
      };
    }
    abortRef.current = null;

    const s = useChatStore.getState();
    // Steps that never finished (aborted mid-run) must not stay "running".
    const finalLines = lines.map((l) => (l.status === 'running' ? { ...l, status: 'failed' as const, detail: 'not completed' } : l));
    s.addMessage({
      role: 'assistant',
      text: result.finalText.trim(),
      report: result.report,
      steps: finalLines,
      stoppedBy: result.stoppedBy,
    });
    s.setLiveSteps(() => []);
    s.setRunning(false);
    s.setPhase('speaking');
    const problem = finalLines.some((l) => l.status === 'failed' || l.status === 'declined') || result.stoppedBy === 'error';
    if (problem) s.react('Alert');
    else if (result.stoppedBy === 'model_done' && finalLines.some((l) => l.status === 'ok')) s.react('Congratulate');
    speakTimer.current = setTimeout(() => useChatStore.getState().setPhase('idle'), SPEAK_MS);
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <>
      <ClippyAgent state={phase} reaction={reaction} onClick={() => useChatStore.getState().setOpen(!open)} onStatus={setAgentStatus} />
      {agentStatus === 'failed' && (
        <button
          type="button"
          className="clippy-toggle"
          data-testid="clippy-toggle"
          aria-expanded={open}
          title="Ask Clippy"
          onClick={() => useChatStore.getState().setOpen(!open)}
        >
          Ask Clippy
        </button>
      )}
      {open && (
        <div className="window clippy-chat" role="dialog" aria-label="Clippy" data-testid="clippy-chat">
          <div className="title-bar">
            <div className="title-bar-text">Clippy</div>
            <div className="title-bar-controls">
              <button type="button" aria-label="Close" onClick={() => useChatStore.getState().setOpen(false)} />
            </div>
          </div>
          <div className="window-body clippy-body">
            <div className="clippy-log sunken-panel" ref={logRef} role="log" aria-live="polite" data-testid="clippy-log">
              {messages.length === 0 && !running && <p className="clippy-hint">It looks like you want help. Ask me to do something.</p>}
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="clippy-message clippy-user" data-testid="clippy-message" data-role="user">
                    <b>You:</b> <span className="clippy-text">{m.text}</span>
                  </div>
                ) : (
                  <div key={m.id} className="clippy-message clippy-assistant" data-testid="clippy-message" data-role="assistant">
                    <b>Clippy:</b>
                    {m.text && <div className="clippy-text">{m.text}</div>}
                    <StepList steps={m.steps} />
                    {m.report && (
                      <pre className="clippy-report" data-testid="clippy-report">
                        {m.report}
                      </pre>
                    )}
                  </div>
                ),
              )}
              {running && (
                <div className="clippy-message clippy-assistant" data-testid="clippy-running">
                  <b>Clippy:</b> <span>Working...</span>
                  <StepList steps={liveSteps} />
                </div>
              )}
            </div>
            <form className="clippy-form" onSubmit={send}>
              <input
                type="text"
                data-testid="clippy-input"
                aria-label="Message to Clippy"
                value={text}
                disabled={running}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" data-testid="clippy-send" disabled={running || !text.trim()}>
                Send
              </button>
              {running && (
                <button type="button" data-testid="clippy-cancel" onClick={cancel}>
                  Cancel
                </button>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function StepList({ steps }: { steps: StepLine[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="clippy-steps">
      {steps.map((s) => (
        <li key={s.id} data-testid="clippy-step" data-status={s.status}>
          [{LABEL[s.status]}] {s.tool}
          {s.detail ? ` - ${s.detail}` : ''}
        </li>
      ))}
    </ul>
  );
}
