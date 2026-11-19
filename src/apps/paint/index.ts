import { registerApp } from '../../desktop/appRegistry';
import { Paint } from './Paint';

export { Paint };
export { getPaintContext, registerPaintContext, type PaintContextSnapshot } from './context';
export { getPaintController, type PaintController } from './controller';
export { HistoryStack, HISTORY_CAPACITY } from './history';

/** Registers Paint with the desktop. Called once at startup. */
export function registerPaint(): void {
  registerApp({
    id: 'paint',
    title: 'Paint',
    icon: 'paint',
    component: Paint,
    fileExtensions: ['png', 'jpg', 'jpeg'],
    singleInstance: false,
  });
}
