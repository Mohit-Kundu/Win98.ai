import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '98.css';
import { DesktopRoot } from './desktop/Desktop';
import { registerExplorer } from './apps/explorer';
import { registerWordPad } from './apps/wordpad';
import { registerPaint } from './apps/paint';
import { registerCmd } from './apps/cmd/register';
import { registerPdfPreview } from './apps/pdfPreview';
import { registerRecycleBin } from './apps/recycleBin';
import { metadataService, searchIndex, syncAppShortcuts } from './actions';

registerExplorer();
registerWordPad();
registerPaint();
registerCmd();
registerPdfPreview();
registerRecycleBin();
void syncAppShortcuts();
metadataService.start();
searchIndex.start();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DesktopRoot />
    </StrictMode>,
  );
}

