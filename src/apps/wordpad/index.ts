import { registerApp } from '../../desktop/appRegistry';
import { WordPad } from './WordPad';

export { WordPad };
export { getWordPadHandle, type WordPadHandle, type WordPadSelection } from './handle';

/** Registers WordPad with the desktop. Called once at startup. */
export function registerWordPad(): void {
  registerApp({
    id: 'wordpad',
    title: 'WordPad',
    icon: 'document',
    component: WordPad,
    fileExtensions: ['wpd', 'txt', 'md'],
    singleInstance: false,
  });
}
