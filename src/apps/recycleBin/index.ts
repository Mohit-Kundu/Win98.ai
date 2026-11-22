import { registerApp } from '../../desktop/appRegistry';
import { RecycleBin } from './RecycleBin';

export { RecycleBin };

/** Application id of the Recycle Bin. The desktop icon switches between empty and full for this id. */
export const RECYCLE_BIN_APP_ID = 'recycleBin';

/** Registers the Recycle Bin with the desktop. Called once at startup. */
export function registerRecycleBin(): void {
  registerApp({
    id: RECYCLE_BIN_APP_ID,
    title: 'Recycle Bin',
    icon: 'recycleBinEmpty',
    component: RecycleBin,
    fileExtensions: [],
    singleInstance: true,
  });
}
