import { useEffect, useState } from 'react';
import { actions, updateMetadata, type NodeInfo, type NodeMeta } from '../../actions';
import { MessageBox, ModalDialog } from '../../ui/dialogs';
import { formatSize, formatTime, parentPath, typeLabel } from './fileTypes';

const parseTags = (s: string): string[] =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');

/** Name, type, size, location, times, editable AI_Metadata and editable user notes. */
export function PropertiesDialog({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const [data, setData] = useState<(NodeInfo & { meta: NodeMeta }) | null>(null);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void actions.readMetadata({ nodeId }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setData(r.value);
        setNotes(r.value.meta.notes ?? '');
        setTitle(r.value.meta.title ?? '');
        setDescription(r.value.meta.description ?? '');
        setCategory(r.value.meta.category ?? '');
        setTags((r.value.meta.tags ?? []).join(', '));
      } else {
        setError(r.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  if (error) return <MessageBox title="Properties" message={error} onClose={onClose} />;
  if (!data) return null;

  const { node, meta, path } = data;
  const isFile = node.kind === 'file';
  const save = async () => {
    const patch: Partial<NodeMeta> = { notes };
    if (isFile) {
      // Fields the user changed are remembered so a later AI run never overwrites them (Req 4.4).
      const next = { title, description, category, tags: parseTags(tags) };
      const edited = new Set(meta.aiEditedFields ?? []);
      if (next.title !== (meta.title ?? '')) edited.add('title');
      if (next.description !== (meta.description ?? '')) edited.add('description');
      if (next.category !== (meta.category ?? '')) edited.add('category');
      if (next.tags.join(', ') !== (meta.tags ?? []).join(', ')) edited.add('tags');
      Object.assign(patch, next, { aiEditedFields: [...edited] });
    }
    const r = await updateMetadata({ nodeId, patch });
    if (r.ok) onClose();
    else setError(r.error.message);
  };

  return (
    <ModalDialog title={`${node.name} Properties`} onClose={onClose}>
      <dl>
        <dt>Name</dt>
        <dd>{node.name}</dd>
        <dt>Type</dt>
        <dd>{typeLabel(node)}</dd>
        <dt>Size</dt>
        <dd>{node.kind === 'folder' ? '' : formatSize(node.size)}</dd>
        <dt>Location</dt>
        <dd>{parentPath(path)}</dd>
        <dt>Created</dt>
        <dd>{formatTime(node.createdAt)}</dd>
        <dt>Modified</dt>
        <dd>{formatTime(node.modifiedAt)}</dd>
        {isFile && (
          <>
            <dt>AI status</dt>
            <dd>{meta.aiStatus === 'error' ? `Error${meta.aiError ? `: ${meta.aiError}` : ''}` : (meta.aiStatus ?? 'none')}</dd>
          </>
        )}
      </dl>
      {isFile && (
        <>
          <div className="field-row-stacked">
            <label htmlFor="explorer-ai-title">AI title</label>
            <input id="explorer-ai-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field-row-stacked">
            <label htmlFor="explorer-ai-description">AI description</label>
            <textarea id="explorer-ai-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field-row-stacked">
            <label htmlFor="explorer-ai-category">AI category</label>
            <input id="explorer-ai-category" type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="field-row-stacked">
            <label htmlFor="explorer-ai-tags">AI tags (comma separated)</label>
            <input id="explorer-ai-tags" type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
        </>
      )}
      <div className="field-row-stacked">
        <label htmlFor="explorer-notes">Notes</label>
        <textarea id="explorer-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="ui-modal-buttons">
        <button type="button" onClick={() => void save()}>
          OK
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </ModalDialog>
  );
}
