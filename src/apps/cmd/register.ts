import { registerApp } from '../../desktop/appRegistry';
import { Cmd } from './Cmd';

/** Registers the CMD app with the desktop. Called once at startup. */
export function registerCmd(): void {
  registerApp({
    id: 'cmd',
    title: 'Command Prompt',
    icon: 'terminal',
    component: Cmd,
    fileExtensions: [],
    singleInstance: false,
  });
}
