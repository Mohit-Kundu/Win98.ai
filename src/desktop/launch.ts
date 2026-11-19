import { useWindowStore } from '../store/windows';
import { getApp } from './appRegistry';

/** Open an app window, or focus the existing one for single-instance apps. Returns null for unknown apps. */
export function launchApp(appId: string, launchArgs?: unknown): string | null {
  const app = getApp(appId);
  if (!app) return null;
  const store = useWindowStore.getState();
  if (app.singleInstance) {
    const existing = store.order.find((id) => store.windows[id]?.appId === appId);
    if (existing) {
      store.focus(existing);
      return existing;
    }
  }
  return store.open(appId, { title: app.title, launchArgs });
}
