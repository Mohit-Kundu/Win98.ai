import React, { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Canvas, Ellipse, FabricImage, Line, PencilBrush, Rect, type FabricObject } from 'fabric';
import { PaintPencil, PaintBrush, PaintErasercolor, PaintCurve } from 'react-old-icons';
import { documentActions, imageActions, readImageFile, type Result } from '../../actions';
import { fitWithin, MAX_SIDE, runAutomate } from './aiImage';
import { err, ok } from '../../../shared/errors';
import { ConfirmDialog, MessageBox, PromptDialog } from '../../ui/dialogs';
import type { AppProps } from '../../desktop/appRegistry';
import { HistoryStack } from './history';
import { useContextProvider } from '../../ai/context';
import { getPaintContext, registerPaintContext } from './context';
import { registerPaintController } from './controller';
import './paint.css';

type Tool = 'pencil' | 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill';

// Win98 pixel-art SVG icons for shape tools that have no equivalent in react-old-icons
const RectIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
    <rect x="2"  y="3"  width="16" height="2" fill="#000"/>
    <rect x="2"  y="15" width="16" height="2" fill="#000"/>
    <rect x="2"  y="3"  width="2"  height="14" fill="#000"/>
    <rect x="16" y="3"  width="2"  height="14" fill="#000"/>
  </svg>
);

const EllipseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
    <rect x="6"  y="2"  width="8" height="2" fill="#000"/>
    <rect x="4"  y="4"  width="2" height="2" fill="#000"/>
    <rect x="14" y="4"  width="2" height="2" fill="#000"/>
    <rect x="2"  y="6"  width="2" height="8" fill="#000"/>
    <rect x="16" y="6"  width="2" height="8" fill="#000"/>
    <rect x="4"  y="14" width="2" height="2" fill="#000"/>
    <rect x="14" y="14" width="2" height="2" fill="#000"/>
    <rect x="6"  y="16" width="8" height="2" fill="#000"/>
  </svg>
);

// Win98 MS Paint fill bucket — pixel trace matching the reference icon
const FillIcon = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">

    {/* ── handle loop (left side, small D shape) ── */}
    <rect x="1" y="3" width="1" height="1" fill="#000"/>
    <rect x="1" y="4" width="1" height="1" fill="#000"/>
    <rect x="1" y="5" width="1" height="1" fill="#000"/>
    <rect x="2" y="2" width="1" height="1" fill="#000"/>
    <rect x="2" y="6" width="1" height="1" fill="#000"/>
    <rect x="3" y="2" width="1" height="1" fill="#000"/>
    <rect x="3" y="6" width="1" height="1" fill="#000"/>
    <rect x="4" y="3" width="1" height="1" fill="#000"/>
    <rect x="4" y="5" width="1" height="1" fill="#000"/>
    {/* handle interior (grey) */}
    <rect x="2" y="3" width="2" height="1" fill="#808080"/>
    <rect x="2" y="4" width="2" height="1" fill="#808080"/>
    <rect x="2" y="5" width="2" height="1" fill="#808080"/>

    {/* ── bucket body outline ── */}
    {/* top edge (runs diagonally upper-left to upper-right) */}
    <rect x="4" y="2" width="1" height="1" fill="#000"/>
    <rect x="5" y="1" width="5" height="1" fill="#000"/>
    <rect x="10" y="2" width="1" height="1" fill="#000"/>
    {/* right wall */}
    <rect x="11" y="3" width="1" height="4" fill="#000"/>
    {/* bottom edge */}
    <rect x="10" y="7" width="1" height="1" fill="#000"/>
    <rect x="5"  y="8" width="5" height="1" fill="#000"/>
    <rect x="4"  y="7" width="1" height="1" fill="#000"/>
    {/* left wall (the open/pouring side) */}
    <rect x="4" y="3" width="1" height="1" fill="#000"/>
    <rect x="4" y="6" width="1" height="1" fill="#000"/>

    {/* ── teal top face of bucket (the lid / angled top plane) ── */}
    <rect x="5" y="2"  width="5" height="1" fill="#008080"/>
    <rect x="5" y="3"  width="5" height="1" fill="#008080"/>
    {/* teal highlight strip */}
    <rect x="6" y="2"  width="3" height="1" fill="#00c8c8"/>

    {/* ── white front face of bucket ── */}
    <rect x="5" y="4" width="5" height="1" fill="#fff"/>
    <rect x="5" y="5" width="5" height="1" fill="#fff"/>
    <rect x="5" y="6" width="5" height="1" fill="#fff"/>
    <rect x="5" y="7" width="5" height="1" fill="#fff"/>

    {/* ── teal shadow on right inside edge ── */}
    <rect x="10" y="3" width="1" height="4" fill="#008080"/>

    {/* ── spout / drip stream from bottom-left corner ── */}
    <rect x="3" y="7" width="1" height="1" fill="#000"/>
    <rect x="3" y="8" width="1" height="1" fill="#000"/>
    <rect x="2" y="9" width="1" height="1" fill="#000"/>

    {/* ── single teardrop drop ── */}
    {/* pointed tip */}
    <rect x="2" y="10" width="1" height="1" fill="#000"/>
    {/* body */}
    <rect x="1" y="11" width="3" height="1" fill="#000"/>
    <rect x="1" y="12" width="3" height="1" fill="#000"/>
    {/* rounded base */}
    <rect x="2" y="13" width="1" height="1" fill="#000"/>

  </svg>
);

// Map each tool to its Win98 MS Paint icon from react-old-icons (or inline SVG for shape tools)
const TOOL_ICONS: Record<Tool, React.ReactNode> = {
  pencil:  <PaintPencil      size={22} />,
  brush:   <PaintBrush       size={22} />,
  eraser:  <PaintErasercolor size={22} />,
  line:    <PaintCurve       size={22} />,
  rect:    <RectIcon />,
  ellipse: <EllipseIcon />,
  fill:    <FillIcon />,
};

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'pencil',  label: 'Pencil' },
  { id: 'brush',   label: 'Brush' },
  { id: 'eraser',  label: 'Eraser' },
  { id: 'line',    label: 'Line' },
  { id: 'rect',    label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'fill',    label: 'Fill' },
];

export const PALETTE = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff',
];
const BRUSH_SIZES = [2, 4, 8, 12, 20];
const DEFAULT_W = 640;
const DEFAULT_H = 480;
const DEFAULT_DIR = 'C:\\My Pictures\\';

interface Snapshot {
  json: string;
  width: number;
  height: number;
}
interface FileInfo {
  fileId?: string;
  path?: string;
  ext?: 'png' | 'jpg';
}
type Dialog =
  | { kind: 'message'; text: string }
  | { kind: 'saveAs' }
  | { kind: 'overwrite'; path: string; data: string }
  | { kind: 'confirmNew' };

function bytesToDataUrl(bytes: ArrayBuffer, mime: string): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

const baseName = (path: string | undefined): string => (path?.split(/[\\/]/).pop() ?? 'untitled').replace(/\.[^.]*$/, '');

/**
 * Flood-fill on the Fabric canvas's underlying HTML canvas element.
 * Renders the full canvas to a temporary offscreen canvas (flattened), runs
 * a BFS fill, then draws the result back as a background-locked image so that
 * Fabric objects remain editable on top.
 */
function floodFill(fabricCanvas: Canvas, startX: number, startY: number, fillHex: string): void {
  // Parse fill colour into r/g/b/a components.
  const br = parseInt(fillHex.slice(1, 3), 16);
  const bg = parseInt(fillHex.slice(3, 5), 16);
  const bb = parseInt(fillHex.slice(5, 7), 16);

  const w = fabricCanvas.getWidth();
  const h = fabricCanvas.getHeight();

  // Flatten the full scene onto an offscreen canvas.
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d', { willReadFrequently: true })!;
  // Draw background colour first.
  ctx.fillStyle = typeof fabricCanvas.backgroundColor === 'string' ? fabricCanvas.backgroundColor : '#ffffff';
  ctx.fillRect(0, 0, w, h);
  // Stamp the current Fabric rendering on top.
  const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1, enableRetinaScaling: false });
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    const ix = Math.round(startX);
    const iy = Math.round(startY);
    if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;

    const idx = (iy * w + ix) * 4;
    const tr = data[idx]!;
    const tg = data[idx + 1]!;
    const tb = data[idx + 2]!;
    const ta = data[idx + 3]!;

    // Nothing to do if the target pixel already matches the fill colour.
    if (tr === br && tg === bg && tb === bb && ta === 255) return;

    const tolerance = 32;
    const matches = (i: number) => {
      const dr = data[i]!     - tr;
      const dg = data[i + 1]! - tg;
      const db = data[i + 2]! - tb;
      const da = data[i + 3]! - ta;
      return Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tolerance;
    };

    const visited = new Uint8Array(w * h);
    const queue: number[] = [iy * w + ix];
    visited[iy * w + ix] = 1;

    while (queue.length > 0) {
      const pos = queue.pop()!;
      const px = pos % w;
      const py = (pos - px) / w;
      const i4 = pos * 4;
      data[i4]     = br;
      data[i4 + 1] = bg;
      data[i4 + 2] = bb;
      data[i4 + 3] = 255;

      const neighbours = [
        px > 0     ? pos - 1 : -1,
        px < w - 1 ? pos + 1 : -1,
        py > 0     ? pos - w : -1,
        py < h - 1 ? pos + w : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && !visited[n] && matches(n * 4)) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Push the filled result back onto the Fabric canvas as a locked image.
    const filledUrl = off.toDataURL('image/png');
    fabricCanvas.clear();
    fabricCanvas.backgroundColor = '#ffffff';
    FabricImage.fromURL(filledUrl).then((fImg) => {
      fImg.set({ left: 0, top: 0, selectable: false, evented: false });
      fabricCanvas.add(fImg);
      fabricCanvas.requestRenderAll();
    });
  };
  img.src = dataUrl;
}

export function Paint({ windowId, launchArgs }: AppProps) {
  useContextProvider('paint', windowId, () => getPaintContext(windowId));
  const hostRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const historyRef = useRef<HistoryStack<Snapshot> | null>(null);

  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(4);
  const [dirty, setDirty] = useState(false);
  const [file, setFile] = useState<FileInfo>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [, bump] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiAbort = useRef<AbortController | null>(null);

  // Latest values for handlers that are attached once.
  const live = useRef({ tool, color, size, dirty, file });
  live.current = { tool, color, size, dirty, file };

  const snapshot = useCallback((): Snapshot => {
    const c = canvasRef.current!;
    return { json: JSON.stringify(c.toJSON()), width: c.getWidth(), height: c.getHeight() };
  }, []);

  const record = useCallback(() => {
    historyRef.current?.push(snapshot());
    setDirty(true);
    bump((n) => n + 1);
  }, [snapshot]);

  const restore = useCallback(async (s: Snapshot) => {
    const c = canvasRef.current;
    if (!c) return;
    c.setDimensions({ width: s.width, height: s.height });
    await c.loadFromJSON(s.json);
    c.requestRenderAll();
  }, []);

  const undo = useCallback(async () => {
    const s = historyRef.current?.undo();
    if (s) {
      await restore(s);
      setDirty(true);
      bump((n) => n + 1);
    }
  }, [restore]);

  const redo = useCallback(async () => {
    const s = historyRef.current?.redo();
    if (s) {
      await restore(s);
      setDirty(true);
      bump((n) => n + 1);
    }
  }, [restore]);

  const resetCanvas = useCallback(() => {
    const c = canvasRef.current!;
    c.clear();
    c.setDimensions({ width: DEFAULT_W, height: DEFAULT_H });
    c.backgroundColor = '#ffffff';
    c.requestRenderAll();
    historyRef.current?.reset(snapshot());
    setFile({});
    setDirty(false);
  }, [snapshot]);

  /** Put an image on the canvas. The canvas is only touched after the image decoded. */
  const placeImage = useCallback(
    async (dataUrl: string, info: FileInfo, dirtyAfter: boolean, keepHistory = false): Promise<Result<{ width: number; height: number }>> => {
      const c = canvasRef.current;
      if (!c) return err('VALIDATION', 'Paint is not ready.');
      let img: FabricImage;
      try {
        img = await FabricImage.fromURL(dataUrl);
      } catch {
        return err('UNSUPPORTED_TYPE', 'The image could not be decoded.');
      }
      if (!img.width || !img.height) return err('UNSUPPORTED_TYPE', 'The image could not be decoded.');
      const { width, height, scale } = fitWithin(img.width, img.height, MAX_SIDE);
      img.set({ left: 0, top: 0, scaleX: scale, scaleY: scale, selectable: false, evented: false });
      c.clear();
      c.setDimensions({ width, height });
      c.backgroundColor = '#ffffff';
      c.add(img);
      c.requestRenderAll();
      if (keepHistory) historyRef.current?.push(snapshot());
      else historyRef.current?.reset(snapshot());
      setFile(info);
      setDirty(dirtyAfter);
      bump((n) => n + 1);
      return ok({ width, height });
    },
    [snapshot],
  );

  const loadFromFileId = useCallback(
    async (fileId: string, opts?: { asNewDrawing?: boolean }) => {
      const r = await readImageFile(fileId);
      if (!r.ok) return r;
      const url = bytesToDataUrl(r.value.bytes, r.value.ext === 'png' ? 'image/png' : 'image/jpeg');
      const asNew = opts?.asNewDrawing === true;
      return placeImage(url, asNew ? { ext: undefined, path: r.value.path.replace(/\.[^.\\]*$/, '.png') } : { fileId, path: r.value.path, ext: r.value.ext }, asNew);
    },
    [placeImage],
  );

  const loadFromBase64 = useCallback(
    async (base64: string, opts?: { keepHistory?: boolean }) => {
      if (typeof base64 !== 'string' || base64.trim() === '') return err('VALIDATION', 'Image data is required.');
      const url = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
      return placeImage(url, {}, true, opts?.keepHistory === true);
    },
    [placeImage],
  );

  // Canvas lifecycle.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const c = new Canvas(el, {
      width: DEFAULT_W,
      height: DEFAULT_H,
      backgroundColor: '#ffffff',
      selection: false,
      skipTargetFind: true,
      enableRetinaScaling: true,
      preserveObjectStacking: true,
    });
    canvasRef.current = c;
    historyRef.current = new HistoryStack(snapshot());

    c.on('path:created', (e) => {
      e.path.set({ selectable: false, evented: false });
      record();
    });

    // Shape drawing.
    let start: { x: number; y: number } | null = null;
    let shape: FabricObject | null = null;
    c.on('mouse:down', (opt) => {
      const { tool: t, color: col, size: sz } = live.current;
      if (t === 'fill') {
        const p = c.getScenePoint(opt.e);
        floodFill(c, p.x, p.y, col);
        // Record history after the async fill settles (next microtask tick).
        setTimeout(() => record(), 0);
        return;
      }
      if (t !== 'line' && t !== 'rect' && t !== 'ellipse') return;
      const p = c.getScenePoint(opt.e);
      start = { x: p.x, y: p.y };
      const common = { stroke: col, strokeWidth: sz, fill: 'transparent', selectable: false, evented: false, strokeUniform: true };
      shape =
        t === 'line'
          ? new Line([p.x, p.y, p.x, p.y], common)
          : t === 'rect'
            ? new Rect({ ...common, left: p.x, top: p.y, width: 0, height: 0 })
            : new Ellipse({ ...common, left: p.x, top: p.y, rx: 0, ry: 0 });
      c.add(shape);
    });
    c.on('mouse:move', (opt) => {
      if (!start || !shape) return;
      const p = c.getScenePoint(opt.e);
      if (shape instanceof Line) {
        shape.set({ x2: p.x, y2: p.y });
      } else if (shape instanceof Ellipse) {
        shape.set({ left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), rx: Math.abs(p.x - start.x) / 2, ry: Math.abs(p.y - start.y) / 2 });
      } else {
        shape.set({ left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
      }
      shape.setCoords();
      c.requestRenderAll();
    });
    c.on('mouse:up', () => {
      if (!start || !shape) return;
      const done = shape;
      start = null;
      shape = null;
      const empty = done instanceof Line ? done.x1 === done.x2 && done.y1 === done.y2 : !done.width && !done.height;
      if (empty) c.remove(done);
      else record();
    });

    const unregisterCtx = registerPaintContext(windowId, () => ({
      app: 'paint',
      fileId: live.current.file.fileId,
      path: live.current.file.path,
      dirty: live.current.dirty,
      width: c.getWidth(),
      height: c.getHeight(),
    }));
    const unregisterCtl = registerPaintController(windowId, { loadImageFromFileId: loadFromFileId, loadImageFromBase64: loadFromBase64 });

    const fileId = (launchArgs as { fileId?: unknown } | undefined)?.fileId;
    if (typeof fileId === 'string') {
      void loadFromFileId(fileId).then((r) => {
        if (!r.ok) setDialog({ kind: 'message', text: r.error.message });
      });
    }

    return () => {
      unregisterCtx();
      unregisterCtl();
      canvasRef.current = null;
      void c.dispose();
    };
    // Mount-only: handlers read current values through refs.
  }, [windowId]);

  // Apply the active tool.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const freehand = tool === 'pencil' || tool === 'brush' || tool === 'eraser';
    c.isDrawingMode = freehand;
    c.defaultCursor = tool === 'fill' ? 'cell' : 'crosshair';
    if (freehand) {
      const brush = new PencilBrush(c);
      brush.color = tool === 'eraser' ? '#ffffff' : color;
      brush.width = tool === 'pencil' ? 1 : tool === 'eraser' ? size * 2 : size;
      c.freeDrawingBrush = brush;
    }
  }, [tool, color, size]);

  const exportPng = (): string => canvasRef.current!.toDataURL({ format: 'png', multiplier: 1, enableRetinaScaling: false });

  const fail = (text: string) => setDialog({ kind: 'message', text: `The drawing could not be saved. ${text}` });

  const saveNew = async (path: string, data: string, overwrite: boolean) => {
    const r = await documentActions.createDrawing({ path, imageBase64: data, overwrite });
    if (r.ok) {
      setFile({ fileId: r.value.fileId, path: r.value.path, ext: 'png' });
      setDirty(false);
      setDialog(null);
    } else if (r.error.code === 'CONFLICT_OVERWRITE') {
      setDialog({ kind: 'overwrite', path, data });
    } else {
      fail(r.error.message);
    }
  };

  const save = async () => {
    const { fileId, ext } = live.current.file;
    if (fileId && ext === 'png') {
      const r = await documentActions.updateDrawing({ fileId, imageBase64: exportPng() });
      if (r.ok) setDirty(false);
      else fail(r.error.message);
    } else {
      setDialog({ kind: 'saveAs' });
    }
  };

  const submitSaveAs = (raw: string) => {
    const name = raw.trim();
    if (name === '') {
      fail('A file name is required.');
      return;
    }
    let path = /[\\/]/.test(name) ? name : DEFAULT_DIR + name;
    if (!/\.[^\\/.]+$/.test(path)) path += '.png';
    setDialog(null);
    void saveNew(path, exportPng(), false);
  };

  const newDrawing = () => {
    if (live.current.dirty) setDialog({ kind: 'confirmNew' });
    else resetCanvas();
  };

  const generate = async () => {
    const ctl = new AbortController();
    aiAbort.current = ctl;
    setAiLoading(true);
    setAiError(null);
    const r = await runAutomate(
      aiPrompt,
      {
        generate: (prompt, signal) => imageActions.generateImageData({ prompt, signal }),
        place: (b64) => loadFromBase64(b64, { keepHistory: true }),
      },
      ctl.signal,
    );
    aiAbort.current = null;
    setAiLoading(false);
    if (r.ok) setAiOpen(false);
    else setAiError(r.error.message);
  };

  const cancelAi = () => {
    if (aiLoading) aiAbort.current?.abort();
    else setAiOpen(false);
  };

  const hist = historyRef.current;
  const label = file.path ?? 'Untitled';

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // Leave text editing in inputs (e.g. the AI prompt) to the browser.
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      void undo();
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      void redo();
    }
  };

  return (
    <div className="paint" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="paint-toolbar">
        <button type="button" onClick={newDrawing}>New</button>
        <button type="button" onClick={() => void save()}>Save</button>
        <button type="button" onClick={() => setDialog({ kind: 'saveAs' })}>Save As...</button>
        <button type="button" disabled={!hist?.canUndo} onClick={() => void undo()}>Undo</button>
        <button type="button" disabled={!hist?.canRedo} onClick={() => void redo()}>Redo</button>
        <button type="button" onClick={() => setAiOpen(true)}>AI Automate...</button>
      </div>
      <div className="paint-main">
        <div className="paint-tools" role="toolbar" aria-label="Tools">
          <div className="paint-tool-grid">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.label}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                className={`paint-tool-btn${tool === t.id ? ' active' : ''}`}
                onClick={() => setTool(t.id)}
              >
                {TOOL_ICONS[t.id]}
              </button>
            ))}
          </div>
          <label className="paint-size">
            Size
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Brush size">
              {BRUSH_SIZES.map((s) => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
          </label>
        </div>
        <div className="paint-surface" onPointerDown={(e) => e.currentTarget.parentElement?.parentElement?.focus({ preventScroll: true })}>
          <canvas ref={hostRef} />
        </div>
      </div>
      <div className="paint-palette" role="radiogroup" aria-label="Palette">
        {PALETTE.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={color === p}
            aria-label={p}
            className={color === p ? 'swatch selected' : 'swatch'}
            style={{ background: p }}
            onClick={() => setColor(p)}
          />
        ))}
      </div>
      <div className="status-bar">
        <p className="status-bar-field">{label}{dirty ? ' *' : ''}</p>
      </div>

      {aiOpen && (
        <div className="window paint-ai" role="dialog" aria-label="AI Automate">
          <div className="title-bar">
            <div className="title-bar-text">AI Automate</div>
          </div>
          <div className="window-body">
            <label htmlFor={`paint-ai-${windowId}`}>Describe the picture to draw:</label>
            <textarea
              id={`paint-ai-${windowId}`}
              rows={3}
              value={aiPrompt}
              disabled={aiLoading}
              maxLength={2000}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
            {aiLoading && <p role="status" className="paint-ai-loading">Generating image, please wait...</p>}
            {aiError && <p role="alert" className="paint-ai-error">{aiError}</p>}
            <div className="paint-ai-buttons">
              <button type="button" disabled={aiLoading || aiPrompt.trim() === ''} onClick={() => void generate()}>Generate</button>
              <button type="button" onClick={cancelAi}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {aiLoading && <div className="paint-ai-overlay" aria-hidden="true" />}

      {dialog?.kind === 'message' && <MessageBox title="Paint" message={dialog.text} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'saveAs' && (
        <PromptDialog
          title="Save As"
          label="File name (saved as PNG in C:\My Pictures unless a path is given)"
          initialValue={`${baseName(file.path)}.png`}
          onSubmit={submitSaveAs}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'overwrite' && (
        <ConfirmDialog
          title="Confirm Save As"
          message={`${dialog.path} already exists. Do you want to replace it?`}
          onConfirm={() => {
            const d = dialog;
            setDialog(null);
            void saveNew(d.path, d.data, true);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'confirmNew' && (
        <ConfirmDialog
          title="Paint"
          message="Discard unsaved changes and start a new drawing?"
          onConfirm={() => {
            setDialog(null);
            resetCanvas();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
