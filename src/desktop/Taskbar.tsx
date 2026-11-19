import { useEffect, useState } from 'react';
import { useWindowStore } from '../store/windows';
import { getApp } from './appRegistry';
import { Icon } from './icons';
import { StartMenu } from './StartMenu';

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="status-bar-field tray-clock" role="timer" aria-label="Clock">
      {formatClock(now)}
    </div>
  );
}

export function Taskbar() {
  const [startOpen, setStartOpen] = useState(false);
  const order = useWindowStore((s) => s.order);
  const windows = useWindowStore((s) => s.windows);
  const focusedId = useWindowStore((s) => s.focusedId);

  const onTaskButton = (id: string) => {
    const { focus, minimize } = useWindowStore.getState();
    const w = windows[id];
    if (!w) return;
    if (w.status === 'minimized' || focusedId !== id) focus(id);
    else minimize(id);
  };

  // Buttons keep opening order, not z-order.
  const ids = [...order].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  return (
    <>
      {startOpen && <StartMenu onClose={() => setStartOpen(false)} />}
      <div className="taskbar" role="toolbar" aria-label="Taskbar">
        <button
          type="button"
          data-start-button
          className={`start-button${startOpen ? ' pressed' : ''}`}
          aria-haspopup="menu"
          aria-expanded={startOpen}
          onClick={() => setStartOpen((o) => !o)}
        >
          <b>Start</b>
        </button>
        <div className="task-buttons">
          {ids.map((id) => {
            const w = windows[id];
            if (!w) return null;
            const active = focusedId === id;
            return (
              <button
                key={id}
                type="button"
                className={`task-button${active ? ' active' : ''}`}
                aria-pressed={active}
                data-status={w.status}
                title={w.title}
                onClick={() => onTaskButton(id)}
              >
                <Icon name={getApp(w.appId)?.icon ?? 'app'} size={16} />
                <span>{w.title}</span>
              </button>
            );
          })}
        </div>
        <Clock />
      </div>
    </>
  );
}
