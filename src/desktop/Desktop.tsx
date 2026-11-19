import { useState } from 'react';
import { AiConfirmHost } from '../ai/confirm';
import { Clippy } from '../apps/clippy/Clippy';
import { useWindowStore } from '../store/windows';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { listApps } from './appRegistry';
import { Icon } from './icons';
import { launchApp } from './launch';
import { Taskbar } from './Taskbar';
import { WindowFrame } from './WindowFrame';
import './desktop.css';

export function Desktop() {
  const order = useWindowStore((s) => s.order);
  const [selected, setSelected] = useState<string | null>(null);
  const icons = listApps().filter((a) => a.desktopIcon !== false);

  return (
    <div className="desktop" onMouseDown={() => setSelected(null)}>
      <div className="workspace">
        <div className="desktop-icons">
          {icons.map((app) => (
            <button
              key={app.id}
              type="button"
              className={`desktop-icon${selected === app.id ? ' selected' : ''}`}
              onMouseDown={(e) => {
                e.stopPropagation();
                setSelected(app.id);
              }}
              onDoubleClick={() => launchApp(app.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') launchApp(app.id);
              }}
            >
              <Icon name={app.icon} />
              <span>{app.title}</span>
            </button>
          ))}
        </div>
        {order.map((id) => (
          <WindowFrame key={id} id={id} />
        ))}
      </div>
      <Taskbar />
      <Clippy />
      <AiConfirmHost />
    </div>
  );
}

export function DesktopRoot() {
  return (
    <ErrorBoundary label="Desktop">
      <Desktop />
    </ErrorBoundary>
  );
}
