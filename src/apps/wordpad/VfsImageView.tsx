import { useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { wordpadFiles } from '../../actions';

type ImageState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'missing' };

/** Loads a VFS image as an object URL and revokes it on change or unmount. */
export function useObjectUrl(vfsId: string | null): ImageState {
  const [state, setState] = useState<ImageState>({ status: 'loading' });
  useEffect(() => {
    if (!vfsId) {
      setState({ status: 'missing' });
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setState({ status: 'loading' });
    wordpadFiles.readBytes(vfsId).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setState({ status: 'missing' });
        return;
      }
      url = URL.createObjectURL(new Blob([r.value.bytes], { type: r.value.node.mime ?? 'image/png' }));
      setState({ status: 'ready', url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [vfsId]);
  return state;
}

/** NodeView for the shared image node. Missing images show a placeholder and the document stays unchanged. */
export function VfsImageView({ node }: NodeViewProps) {
  const vfsId = (node.attrs.vfsId as string | null) ?? null;
  const alt = (node.attrs.alt as string | null) ?? '';
  const state = useObjectUrl(vfsId);
  return (
    <NodeViewWrapper className="wp-image" data-vfs-id={vfsId ?? undefined}>
      {state.status === 'ready' && <img src={state.url} alt={alt} draggable={false} />}
      {state.status === 'loading' && <span className="wp-image-loading">Loading image...</span>}
      {state.status === 'missing' && (
        <span className="wp-image-missing" role="img" aria-label="Image not found">
          Image not found
        </span>
      )}
    </NodeViewWrapper>
  );
}
