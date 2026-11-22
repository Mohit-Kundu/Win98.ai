import type { ReactElement } from 'react';

/** Small local retro icon set (inline SVG, no dependency). */
export type IconName = 'folder' | 'paint' | 'document' | 'terminal' | 'assistant' | 'app' | 'recycleBinEmpty' | 'recycleBinFull';

const shapes: Record<IconName, ReactElement> = {
  folder: (
    <>
      <path d="M2 8h10l2 3h16v16H2z" fill="#ffd84d" stroke="#000" />
      <path d="M2 14h28" stroke="#b58b00" />
    </>
  ),
  paint: (
    <>
      <rect x="3" y="4" width="26" height="24" fill="#fff" stroke="#000" />
      <circle cx="11" cy="12" r="3" fill="#e00000" />
      <circle cx="20" cy="11" r="3" fill="#0040e0" />
      <circle cx="16" cy="21" r="3" fill="#00a000" />
    </>
  ),
  document: (
    <>
      <path d="M6 3h14l6 6v20H6z" fill="#fff" stroke="#000" />
      <path d="M10 14h12M10 18h12M10 22h8" stroke="#000080" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="5" width="28" height="22" fill="#000" stroke="#808080" />
      <path d="M6 11l5 4-5 4M14 20h8" stroke="#c0c0c0" fill="none" />
    </>
  ),
  assistant: (
    <>
      <path d="M12 4a6 6 0 0 1 12 0v16a8 8 0 0 1-16 0V10" fill="none" stroke="#606060" strokeWidth="2.5" />
      <circle cx="14" cy="22" r="2" fill="#000" />
    </>
  ),
  app: (
    <>
      <rect x="3" y="5" width="26" height="22" fill="#c0c0c0" stroke="#000" />
      <rect x="3" y="5" width="26" height="5" fill="#000080" stroke="#000" />
    </>
  ),
  recycleBinEmpty: (
    <>
      <path d="M8 10h16l-2 18H10z" fill="#c0c0c0" stroke="#000" />
      <rect x="6" y="7" width="20" height="3" fill="#808080" stroke="#000" />
      <path d="M13 6h6v1h-6z" fill="#808080" stroke="#000" />
      <path d="M12 13l1 12M16 13v12M20 13l-1 12" stroke="#404040" />
    </>
  ),
  recycleBinFull: (
    <>
      <path d="M9 4l5 4M17 3l-2 5M22 5l-5 3" stroke="#000" fill="none" />
      <rect x="10" y="3" width="6" height="6" fill="#fff" stroke="#000" />
      <rect x="17" y="5" width="6" height="5" fill="#ffd84d" stroke="#000" />
      <path d="M8 10h16l-2 18H10z" fill="#c0c0c0" stroke="#000" />
      <rect x="6" y="9" width="20" height="3" fill="#808080" stroke="#000" />
      <path d="M12 15l1 10M16 15v10M20 15l-1 10" stroke="#404040" />
    </>
  ),
};

export function Icon({ name, size = 32 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      {shapes[name] ?? shapes.app}
    </svg>
  );
}
