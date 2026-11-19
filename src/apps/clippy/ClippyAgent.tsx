import { useEffect, useRef } from 'react';
import { initAgent } from 'clippyjs';

export type ClippyState = 'idle' | 'thinking' | 'speaking';

export interface ClippyAgentProps {
  state: ClippyState;
  onClick?: () => void;
}

/** Minimal surface of a clippyjs Agent that this component uses. */
interface AgentLike {
  show(fast?: boolean): unknown;
  play(animation: string, timeout?: number, cb?: () => void): unknown;
  stop(): void;
  dispose(): void;
  _el?: HTMLElement;
}

const BASE = '/clippy/';
const THINK_MS = 4000;

// Assets are served from public/clippy/ (see scripts/copy-clippy-assets.mjs). No CDN, no TTS.
const loaders = {
  agent: async () => ({ default: await (await fetch(`${BASE}agent.json`)).json() }),
  map: async () => ({ default: `${BASE}map.png` }),
  // Agent sound effects are animation cues only, not speech.
  sound: async () => ({ default: await (await fetch(`${BASE}sounds.json`)).json() }),
};

/**
 * Floating, draggable Clippy. Drag and positioning are provided by clippyjs.
 * idle -> library idle animations, thinking -> "Thinking" loop, speaking -> "Explain".
 */
export function ClippyAgent({ state, onClick }: ClippyAgentProps) {
  const agentRef = useRef<AgentLike | null>(null);
  const stateRef = useRef(state);
  const clickRef = useRef(onClick);
  stateRef.current = state;
  clickRef.current = onClick;

  // Mount / unmount the agent. `cancelled` guards against StrictMode double mount.
  useEffect(() => {
    let cancelled = false;
    let agent: AgentLike | null = null;
    let cleanupEl: (() => void) | undefined;

    initAgent(loaders as unknown as Parameters<typeof initAgent>[0])
      .then((a) => {
        const created = a as unknown as AgentLike;
        if (cancelled) {
          created.dispose();
          return;
        }
        agent = created;
        agentRef.current = created;
        created.show(true);
        applyState(created, stateRef.current);

        const el = created._el;
        if (el) {
          el.setAttribute('data-testid', 'clippy-agent');
          let down: { x: number; y: number } | null = null;
          const onDown = (e: MouseEvent) => {
            down = { x: e.clientX, y: e.clientY };
          };
          const onUp = (e: MouseEvent) => {
            if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) clickRef.current?.();
            down = null;
          };
          el.addEventListener('mousedown', onDown);
          el.addEventListener('mouseup', onUp);
          cleanupEl = () => {
            el.removeEventListener('mousedown', onDown);
            el.removeEventListener('mouseup', onUp);
          };
        }
      })
      .catch((err) => {
        console.error('Clippy failed to load', err);
      });

    return () => {
      cancelled = true;
      cleanupEl?.();
      agent?.dispose();
      agentRef.current = null;
    };
  }, []);

  // Map state to animation.
  useEffect(() => {
    if (agentRef.current) applyState(agentRef.current, state);
    if (state !== 'thinking') return;
    const t = setInterval(() => agentRef.current?.play('Thinking', THINK_MS), THINK_MS);
    return () => clearInterval(t);
  }, [state]);

  return null;
}

function applyState(agent: AgentLike, state: ClippyState) {
  agent.stop();
  if (state === 'thinking') agent.play('Thinking', THINK_MS);
  else if (state === 'speaking') agent.play('Explain', THINK_MS);
  // idle: stop() returns the agent to its idle animations.
}
