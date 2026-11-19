import { Rnd } from 'react-rnd';
import { MIN_H, MIN_W, useWindowStore, zOf } from '../store/windows';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { getApp } from './appRegistry';

export function WindowFrame({ id }: { id: string }) {
  const win = useWindowStore((s) => s.windows[id]);
  const z = useWindowStore((s) => zOf(s.order, id));
  const focused = useWindowStore((s) => s.focusedId === id);
  const { focus, close, minimize, maximize, restore, move, resize } = useWindowStore.getState();

  if (!win) return null;
  const app = getApp(win.appId);
  const App = app?.component;
  const maximized = win.status === 'maximized';
  const hidden = win.status === 'minimized';

  return (
    <Rnd
      position={maximized ? { x: 0, y: 0 } : { x: win.x, y: win.y }}
      size={maximized ? { width: '100%', height: '100%' } : { width: win.width, height: win.height }}
      minWidth={MIN_W}
      minHeight={MIN_H}
      bounds="parent"
      dragHandleClassName="title-bar"
      cancel=".title-bar-controls"
      disableDragging={maximized}
      enableResizing={!maximized}
      onMouseDown={() => focus(id)}
      onDragStop={(_e, d) => move(id, d.x, d.y)}
      onResizeStop={(_e, _dir, ref, _delta, pos) => resize(id, ref.offsetWidth, ref.offsetHeight, pos.x, pos.y)}
      style={{ zIndex: z + 1, display: hidden ? 'none' : 'flex' }}
      data-testid={`window-${id}`}
    >
      <div className={`window win-frame${focused ? '' : ' inactive'}`} role="dialog" aria-label={win.title}>
        <div className={`title-bar${focused ? '' : ' inactive'}`} onDoubleClick={() => (maximized ? restore(id) : maximize(id))}>
          <div className="title-bar-text">{win.title}</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Minimize" onClick={() => minimize(id)} />
            {maximized ? (
              <button type="button" aria-label="Restore" onClick={() => restore(id)} />
            ) : (
              <button type="button" aria-label="Maximize" onClick={() => maximize(id)} />
            )}
            <button type="button" aria-label="Close" onClick={() => close(id)} />
          </div>
        </div>
        <div className="window-body win-body">
          <ErrorBoundary label={win.title} onDismiss={() => close(id)}>
            {App ? <App windowId={id} launchArgs={win.launchArgs} /> : <p>Application "{win.appId}" is not available.</p>}
          </ErrorBoundary>
        </div>
      </div>
    </Rnd>
  );
}
