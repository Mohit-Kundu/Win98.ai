import { listApps } from '../desktop/appRegistry';
import { vfs as sharedVfs, type VfsService } from '../vfs/service';
import { nameKey } from '../vfs/paths';

export interface AppShortcutDeps {
  vfs?: VfsService;
  /** Applications to represent. Defaults to the desktop app registry. */
  apps?: () => Array<{ id: string; title: string }>;
}

const PROGRAM_FILES = 'C:\\Program Files';

/** File-name-safe version of an app title. */
export const shortcutName = (title: string): string => `${title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Application'}.lnk`;

/**
 * Makes sure C:\Program Files holds one read-only shortcut per registered application, so Explorer,
 * CMD and Clippy can see (and be refused deleting) applications. Safe to call repeatedly.
 */
export function createAppShortcutSync(deps: AppShortcutDeps = {}): () => Promise<void> {
  const vfs = deps.vfs ?? sharedVfs;
  const apps = deps.apps ?? listApps;
  return async () => {
    try {
      await vfs.init();
      const dir = await vfs.resolve(PROGRAM_FILES);
      if (!dir.ok) return;
      const have = new Set((await vfs.list(dir.value.id)).map((n) => nameKey(n.name)));
      for (const app of apps()) {
        const name = shortcutName(app.title);
        if (have.has(nameKey(name))) continue;
        have.add(nameKey(name));
        await vfs.create({
          parentId: dir.value.id,
          name,
          kind: 'file',
          bytes: new TextEncoder().encode(JSON.stringify({ appId: app.id })).buffer as ArrayBuffer,
          mime: 'application/json',
          system: 'shortcut',
        });
      }
    } catch (e) {
      console.error('Application shortcut sync failed', e);
    }
  };
}

/** Application-wide sync. Called once at startup after the apps are registered. */
export const syncAppShortcuts = createAppShortcutSync();
