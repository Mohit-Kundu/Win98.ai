import { registerApp } from '../../desktop/appRegistry';
import { PdfPreview } from './PdfPreview';
export { PdfPreview };
/** Registers the read-only PDF preview. Called once at startup. */
export function registerPdfPreview(): void {
  registerApp({
    id: 'pdfPreview',
    title: 'PDF Preview',
    icon: 'document',
    component: PdfPreview,
    fileExtensions: ['pdf'],
    singleInstance: false,
    desktopIcon: false,
  });
}
