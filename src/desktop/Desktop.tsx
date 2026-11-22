import { useEffect, useRef, useState } from 'react';
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

const CELL_W = 84;
const CELL_H = 78;
const PAD = 8;
const TASKBAR_H = 28;
const STORAGE_KEY = 'win98.desktopIconCells';

type Cell = { col: number; row: number };
type Cells = Record<string, Cell>;

const cellKey = (c: Cell) => `${c.col},${c.row}`;

function gridSize() {
  return {
    cols: Math.max(1, Math.floor((window.innerWidth - PAD) / CELL_W)),
    rows: Math.max(1, Math.floor((window.innerHeight - TASKBAR_H - PAD) / CELL_H)),
  };
}

function loadCells(): Cells {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Cells) : {};
  } catch {
    return {};
  }
}

function saveCells(cells: Cells) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cells));
  } catch {
    /* ignore storage failures */
  }
}

/** Assign each icon a cell: saved cell if valid and unique, else the next free cell in column-major order. */
function resolveCells(ids: string[], saved: Cells): Cells {
  const { cols, rows } = gridSize();
  const taken = new Set<string>();
  const out: Cells = {};
  for (const id of ids) {
    const c = saved[id];
    if (c && c.col >= 0 && c.row >= 0 && c.col < cols && c.row < rows && !taken.has(cellKey(c))) {
      out[id] = c;
      taken.add(cellKey(c));
    }
  }
  let n = 0;
  for (const id of ids) {
    if (out[id]) continue;
    let c: Cell;
    do {
      c = { col: Math.floor(n / rows), row: n % rows };
      n++;
    } while (taken.has(cellKey(c)) && n < cols * rows + ids.length);
    out[id] = c;
    taken.add(cellKey(c));
  }
  return out;
}

function nearestFreeCell(target: Cell, taken: Set<string>): Cell {
  const { cols, rows } = gridSize();
  let best: Cell = target;
  let bestDist = Infinity;
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      if (taken.has(cellKey({ col, row }))) continue;
      const d = (col - target.col) ** 2 + (row - target.row) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = { col, row };
      }
    }
  }
  return best;
}

export function Desktop() {
  const order = useWindowStore((s) => s.order);
  const [selected, setSelected] = useState<string | null>(null);
  const icons = listApps().filter((a) => a.desktopIcon !== false);
  const [saved, setSaved] = useState<Cells>(loadCells);
  const [, setResizeTick] = useState(0);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const cells = resolveCells(icons.map((a) => a.id), saved);

  useEffect(() => {
    const onResize = () => setResizeTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) {
      setDrag(null);
      return;
    }
    const { cols, rows } = gridSize();
    const start = cells[id]!;
    const col = Math.min(cols - 1, Math.max(0, Math.round(start.col + (e.clientX - d.startX) / CELL_W)));
    const row = Math.min(rows - 1, Math.max(0, Math.round(start.row + (e.clientY - d.startY) / CELL_H)));
    const taken = new Set(
      Object.entries(cells)
        .filter(([other]) => other !== id)
        .map(([, c]) => cellKey(c)),
    );
    const next = { ...cells, [id]: nearestFreeCell({ col, row }, taken) };
    setSaved(next);
    saveCells(next);
    setDrag(null);
  };

  return (
    <div className="desktop" onMouseDown={() => setSelected(null)}>
      <div className="workspace">
        <div className="desktop-icons">
          {icons.map((app) => {
            const cell = cells[app.id]!;
            const dragging = drag?.id === app.id;
            return (
            <button
              key={app.id}
              type="button"
              className={`desktop-icon${selected === app.id ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
              style={{
                left: PAD + cell.col * CELL_W + (dragging ? drag.dx : 0),
                top: PAD + cell.row * CELL_H + (dragging ? drag.dy : 0),
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setSelected(app.id);
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                dragRef.current = { id: app.id, startX: e.clientX, startY: e.clientY, moved: false };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d || d.id !== app.id) return;
                const dx = e.clientX - d.startX;
                const dy = e.clientY - d.startY;
                if (!d.moved && Math.hypot(dx, dy) < 4) return;
                d.moved = true;
                setDrag({ id: app.id, dx, dy });
              }}
              onPointerUp={(e) => endDrag(e, app.id)}
              onPointerCancel={() => {
                dragRef.current = null;
                setDrag(null);
              }}
              onDoubleClick={() => launchApp(app.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') launchApp(app.id);
              }}
            >
              <Icon name={app.icon} />
              <span>{app.title}</span>
            </button>
            );
          })}
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
