import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { VfsImage } from '../../actions';
import { VfsImageView } from './VfsImageView';

/** Same schema as `wordpadExtensions` in src/actions, with a React NodeView for images. */
export const editorExtensions = [
  StarterKit,
  VfsImage.extend({
    addNodeView() {
      return ReactNodeViewRenderer(VfsImageView);
    },
  }),
];
