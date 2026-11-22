import { describe, expect, it } from 'vitest';
import { animationForToolStart, animationForToolSuccess } from './toolAnimations';

describe('tool animations', () => {
  it('maps running tools to animations', () => {
    for (const t of ['create_document', 'update_document', 'insert_image_into_document', 'read_document']) {
      expect(animationForToolStart(t)).toBe('Writing');
    }
    for (const t of ['generate_image', 'create_drawing', 'update_drawing']) expect(animationForToolStart(t)).toBe('GetArtsy');
    expect(animationForToolStart('search_files')).toBe('Searching');
    expect(animationForToolStart('delete_node')).toBe('EmptyTrash');
    expect(animationForToolStart('list_folder')).toBeUndefined();
  });

  it('plays Save for persisting tools and Congratulate otherwise', () => {
    expect(animationForToolSuccess('create_document')).toBe('Save');
    expect(animationForToolSuccess('search_files')).toBe('Congratulate');
  });
});
