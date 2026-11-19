import { registry as defaultRegistry, type AnyToolDef, type ToolRegistry } from '../registry';
import { createDrawing, generateImage, updateDrawing } from './drawings';
import { createDocument, insertImageIntoDocument, readDocument, updateDocument } from './documents';
import { createFolder, deleteNode, listFolder, moveNode, openApplication, openFile, organizeFiles, readFileMetadata, renameNode, runCommand, searchFiles } from './files';

/** Tools backed by the Action_Layer. */
export const coreTools: AnyToolDef[] = [
  listFolder,
  createFolder,
  readFileMetadata,
  searchFiles,
  readDocument,
  createDocument,
  updateDocument,
  insertImageIntoDocument,
  generateImage,
  createDrawing,
  updateDrawing,
  deleteNode,
  renameNode,
  moveNode,
  organizeFiles,
  openFile,
  openApplication,
  runCommand,
];

/** Register the tools once. Safe to call repeatedly. */
export function registerCoreTools(target: ToolRegistry = defaultRegistry): void {
  for (const t of coreTools) if (!target.get(t.name)) target.register(t);
}

export * from './shared';
