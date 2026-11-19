import { useEffect, useRef } from 'react';
import { useWindowStore } from '../store/windows';
import type { AiContextSnapshot } from './types';

export const MAX_SELECTION_CHARS = 4000;
export const MAX_EXCERPT_CHARS = 2000;

export type AppContextSnapshot =
  | { app: 'wordpad'; fileId?: string; path?: string; selection?: { from: number; to: number; text: string }; docTextExcerpt?: string }
  | { app: 'paint'; fileId?: string; path?: string; dirty: boolean; width: number; height: number }
  | { app: 'explorer'; folderId: string; folderPath: string; selectedIds: string[] }
  | { app: 'cmd'; cwd: string };

export interface AppContextProvider {
  appId: string;
  windowId: string;
  /** Small, JSON-safe snapshot. Never file bytes or full documents. */
  describe(): AppContextSnapshot | undefined;
}

const providers = new Map<string, AppContextProvider>();

/** Register a provider for a window. Returns an unregister function. */
export function registerContextProvider(provider: AppContextProvider): () => void {
  providers.set(provider.windowId, provider);
  return () => {
    if (providers.get(provider.windowId) === provider) providers.delete(provider.windowId);
  };
}

export function getContextProvider(windowId: string): AppContextProvider | undefined {
  return providers.get(windowId);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function limit(snapshot: AppContextSnapshot): AppContextSnapshot {
  if (snapshot.app !== 'wordpad') return snapshot;
  const out = { ...snapshot };
  if (out.selection) out.selection = { ...out.selection, text: truncate(out.selection.text, MAX_SELECTION_CHARS) };
  if (out.docTextExcerpt !== undefined) out.docTextExcerpt = truncate(out.docTextExcerpt, MAX_EXCERPT_CHARS);
  return out;
}

/** Builds the Orchestrator context from the focused window's provider only. */
export function buildAiContext(focusedWindowId?: string | null): AiContextSnapshot {
  const id = focusedWindowId === undefined ? useWindowStore.getState().focusedId : focusedWindowId;
  if (!id) return {};
  const provider = providers.get(id);
  if (!provider) return {};
  let raw: AppContextSnapshot | undefined;
  try {
    raw = provider.describe();
  } catch {
    return { activeApp: provider.appId };
  }
  if (!raw) return { activeApp: provider.appId };
  const snapshot = limit(raw);
  const cwdHint = snapshot.app === 'cmd' ? snapshot.cwd : snapshot.app === 'explorer' ? snapshot.folderPath : undefined;
  return { activeApp: provider.appId, snapshot, ...(cwdHint ? { cwdHint } : {}) };
}

/** Registers a Context_Provider for the window while it is mounted. `describe` may change every render. */
export function useContextProvider(appId: string, windowId: string, describe: () => AppContextSnapshot | undefined): void {
  const ref = useRef(describe);
  useEffect(() => {
    ref.current = describe;
  });
  useEffect(
    () => registerContextProvider({ appId, windowId, describe: () => ref.current() }),
    [appId, windowId],
  );
}
