import { launchApp } from '../desktop/launch';
import { vfs } from '../vfs/service';
import { createCoreActions } from './core';

export * from './types';
export { createCoreActions, type CoreDeps } from './core';
export { appForFileName, validateUpload } from './associations';

/** Application-wide actions bound to the shared VFS and window store. */
export const actions = createCoreActions({ vfs, launch: launchApp });

import { createMetadataActions } from './metadata';
export { createMetadataActions, type MetadataActions, type UpdateMetadataInput } from './metadata';
export const { updateMetadata } = createMetadataActions({ vfs });

export { createDocumentActions, type DocumentActions, type DocumentDeps, type ImagePosition } from './documents';
export * from './wordpad/format';
export { documentBus, DocumentBus, type DocumentUpdate } from './wordpad/documentBus';
import { createDocumentActions } from './documents';

/** Document and drawing actions bound to the shared VFS. */
export const documentActions = createDocumentActions({ vfs, core: actions });

import { aiClient } from '../ai/client';
import { createImageActions } from './images';
export { createImageActions, type ImageActions, type ImageDataActions, type ImageDeps, type GenerateImageInput } from './images';
/** AI image generation saved to the VFS. */
export const imageActions = createImageActions({ ai: aiClient, drawings: documentActions });

export { executeCommand, createExecuteCommand, type ExecuteCommand, type ExecuteCommandInput, type ExecuteCommandOutput } from './command';
export * from './wordpadFiles';
export * from './media';
export * from './pdf';
export { createMetadataService, metadataService, type MetadataService, type MetadataServiceDeps } from './metadataService';
export { createSearchIndex, searchIndex, type SearchIndex, type SearchFilters } from './searchIndex';
export {
  createSearchService,
  planWithoutAi,
  type NaturalSearchInput,
  type SearchActions,
  type SearchFilesInput,
  type SearchHit,
  type SearchPlan,
  type SearchService,
} from './search';
import { createSearchService } from './search';
/** Search over the shared VFS. `searchFiles` is the public action; `searchNatural` adds query planning. */
export const searchService = createSearchService();
export const { searchFiles, searchNatural } = searchService;
export {
  createOrganizeService,
  sanitizeDestination,
  MAX_ORGANIZE_FILES,
  type OrganizeActions,
  type OrganizeFilesInput,
  type OrganizeFilesOutput,
  type OrganizeMoveInput,
  type OrganizeMoveProposal,
  type OrganizeProposal,
  type OrganizeService,
  type ProposeOrganizationInput,
} from './organize';
import { createOrganizeService } from './organize';
/** Auto-organize. `proposeOrganization` asks the AI; `organizeFiles` applies the moves. */
export const organizeService = createOrganizeService();
export const { proposeOrganization, organizeFiles } = organizeService;
export { textTransform, type TextTransformInput, type TextTransformMode, type TextTransformOutput } from './text';
