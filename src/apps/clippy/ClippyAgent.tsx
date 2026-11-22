import { useEffect, useRef } from 'react';
import { initAgent } from 'clippyjs';

export type ClippyState = 'idle' | 'thinking' | 'speaking';

export interface ClippyAgentProps {
  state: ClippyState;
  /** One-shot reaction. Plays whenever id changes, overriding the state animation. */
  reaction?: { id: number; animation: string } | null;
  onClick?: () => void;
  /** Reports whether the agent loaded ('ready') or failed to load ('failed'). */
  onStatus?: (s: 'ready' | 'failed') => void;
}

/** Minimal surface of a clippyjs Agent that this component uses. */
interface AgentLike {
  show(fast?: boolean): unknown;
  play(animation: string, timeout?: number, cb?: () => void): unknown;
  stop(): void;
  dispose(): void;
  reposition?(): void;
  _el?: HTMLElement;
}

const BASE = '/clippy/';
const THINK_MS = 4000;
const REACTION_MS = 5000;
const IDLE_MIN_MS = 6000;
const IDLE_MAX_MS = 12000;
const IDLE_ANIM_TIMEOUT_MS = 5000;
const IDLE_ANIMATIONS = [
  'IdleEyeBrowRaise',
  'IdleFingerTap',
  'IdleHeadScratch',
  'IdleSideToSide',
  'IdleAtom',
  'IdleRopePile',
  'LookLeft',
  'LookRight',
  'LookUp',
  'LookDown',
  'CheckingSomething',
  'GetTechy',
  'GetArtsy',
];
const TASKBAR_H = 28;
const MARGIN = 8;
/** Above .clippy-chat (99991) and windows, below the taskbar (100000). */
const AGENT_Z = '99992';

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
export function ClippyAgent({ state, reaction, onClick, onStatus }: ClippyAgentProps) {
  const agentRef = useRef<AgentLike | null>(null);
  const stateRef = useRef(state);
  const reactionAtRef = useRef(0);
  const clickRef = useRef(onClick);
  const statusRef = useRef(onStatus);
  stateRef.current = state;
  clickRef.current = onClick;
  statusRef.current = onStatus;

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
          // show(true) skips clippyjs placement, so without this the fixed element sits below the viewport.
          el.style.zIndex = AGENT_Z;
          el.style.left = `${Math.max(0, window.innerWidth - el.offsetWidth - MARGIN)}px`;
          el.style.top = `${Math.max(0, window.innerHeight - el.offsetHeight - TASKBAR_H - MARGIN)}px`;
          created.reposition?.();
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
        statusRef.current?.('ready');
      })
      .catch((err) => {
        console.error('Clippy failed to load', err);
        if (!cancelled) statusRef.current?.('failed');
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
    if (state === 'thinking') {
      // Do not cut a reaction (tool animation) short by replaying Thinking.
      const t = setInterval(() => {
        if (Date.now() - reactionAtRef.current >= REACTION_MS) agentRef.current?.play('Thinking', THINK_MS);
      }, THINK_MS);
      return () => clearInterval(t);
    }
    if (state === 'idle') {
      // Play a random idle animation every few seconds while nothing else is happening.
      let timer: ReturnType<typeof setTimeout>;
      const schedule = () => {
        const delay = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
        timer = setTimeout(() => {
          const anim = IDLE_ANIMATIONS[Math.floor(Math.random() * IDLE_ANIMATIONS.length)];
          if (anim) agentRef.current?.play(anim, IDLE_ANIM_TIMEOUT_MS);
          schedule();
        }, delay);
      };
      schedule();
      return () => clearTimeout(timer);
    }
  }, [state]);

  // Declared after the state effect so a reaction wins when both change in the same render.
  const reactionId = reaction?.id;
  const reactionAnim = reaction?.animation;
  useEffect(() => {
    const agent = agentRef.current;
    if (!agent || reactionId === undefined || !reactionAnim) return;
    reactionAtRef.current = Date.now();
    agent.stop();
    agent.play(reactionAnim, REACTION_MS);
  }, [reactionId, reactionAnim]);

  return null;
}

function applyState(agent: AgentLike, state: ClippyState) {
  agent.stop();
  if (state === 'thinking') agent.play('Thinking', THINK_MS);
  else if (state === 'speaking') agent.play('Explain', THINK_MS);
  // idle: stop() returns the agent to its idle animations.
}
