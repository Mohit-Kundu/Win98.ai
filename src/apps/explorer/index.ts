import { registerApp } from '../../desktop/appRegistry';
import { Explorer } from './Explorer';

export { Explorer };

/** Registers File Explorer with the desktop. Called once at startup. */
export function registerExplorer(): void {
  registerApp({
    id: 'explorer',
    title: 'File Explorer',
    icon: 'folder',
    component: Explorer,
    fileExtensions: [],
    singleInstance: false,
  });
}
