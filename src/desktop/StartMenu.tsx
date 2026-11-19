import { useEffect, useRef } from 'react';
import { listApps } from './appRegistry';
import { Icon } from './icons';
import { launchApp } from './launch';

export function StartMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-start-button]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const apps = listApps();
  return (
    <div ref={ref} className="window start-menu" role="menu" aria-label="Start menu">
      <div className="start-banner" aria-hidden="true">
        <span>Windows<b>98</b></span>
      </div>
      <ul className="start-items">
        {apps.length === 0 && <li className="start-empty">No programs installed</li>}
        {apps.map((app) => (
          <li key={app.id} role="none">
            <button
              type="button"
              role="menuitem"
              className="start-item"
              onClick={() => {
                launchApp(app.id);
                onClose();
              }}
            >
              <Icon name={app.icon} size={24} />
              <span>{app.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
