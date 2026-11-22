/** Clippy animations that are triggered by tool activity or tool results. */
export type ToolAnimation = 'Writing' | 'GetArtsy' | 'Searching' | 'EmptyTrash' | 'Save' | 'Congratulate';

/** Animation to play while a tool runs. Tools not listed keep the normal "Thinking" animation. */
const RUNNING: Record<string, ToolAnimation> = {
  read_document: 'Writing',
  create_document: 'Writing',
  update_document: 'Writing',
  insert_image_into_document: 'Writing',
  generate_image: 'GetArtsy',
  create_drawing: 'GetArtsy',
  update_drawing: 'GetArtsy',
  search_files: 'Searching',
  delete_node: 'EmptyTrash',
};

/** Tools that change stored data. A successful run of one of these plays "Save". */
const PERSISTING = new Set([
  'create_document',
  'update_document',
  'insert_image_into_document',
  'create_drawing',
  'update_drawing',
  'generate_image',
  'create_folder',
  'rename_node',
  'move_node',
  'organize_files',
  'delete_node',
]);

export function animationForToolStart(tool: string): ToolAnimation | undefined {
  return RUNNING[tool];
}

export function animationForToolSuccess(tool: string): ToolAnimation {
  return PERSISTING.has(tool) ? 'Save' : 'Congratulate';
}
