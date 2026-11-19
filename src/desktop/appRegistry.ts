import type { ComponentType } from 'react';
import type { AppId } from '../store/windows';
import type { IconName } from './icons';

export interface AppProps {
  windowId: string;
  launchArgs?: unknown;
}

export interface AppDefinition {
  id: AppId;
  title: string;
  icon: IconName;
  component: ComponentType<AppProps>;
  /** Lowercase extensions (no dot) this app opens. */
  fileExtensions: string[];
  singleInstance: boolean;
  /** Show a desktop icon. Defaults to true. */
  desktopIcon?: boolean;
}

const apps = new Map<AppId, AppDefinition>();

/**
 * Extension point: each milestone registers the apps it delivers.
 * The registry starts empty so no app is listed before it exists.
 */
export function registerApp(def: AppDefinition): void {
  apps.set(def.id, def);
}

export function unregisterApp(id: AppId): void {
  apps.delete(id);
}

export function getApp(id: AppId): AppDefinition | undefined {
  return apps.get(id);
}

export function listApps(): AppDefinition[] {
  return [...apps.values()];
}
