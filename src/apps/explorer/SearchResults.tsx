import type { SearchHit } from '../../actions';
import { Icon } from '../../desktop/icons';
import { iconFor, typeLabel } from './fileTypes';

export function SearchResults({ hits, onOpen }: { hits: SearchHit[]; onOpen: (hit: SearchHit) => void }) {
  return (
    <div className="explorer-list sunken-panel" role="list" aria-label="Search results">
      <div className="explorer-row explorer-result explorer-head" aria-hidden="true">
        <span />
        <span>Name</span>
        <span>Location</span>
        <span>Type</span>
        <span>Description</span>
        <span />
      </div>
      {hits.map((h) => {
        const node = { kind: h.kind, ext: h.type === 'folder' ? undefined : h.type };
        return (
          <div key={h.id} role="listitem" className="explorer-row explorer-result" onDoubleClick={() => onOpen(h)}>
            <Icon name={iconFor(node)} size={16} />
            <span className="explorer-name">{h.name}</span>
            <span title={h.location}>{h.location}</span>
            <span>{typeLabel(node)}</span>
            <span title={h.description}>{h.description}</span>
            <button type="button" aria-label={`Open ${h.name}`} onClick={() => onOpen(h)}>
              Open
            </button>
          </div>
        );
      })}
      {hits.length === 0 && <p className="explorer-empty">No files match your search.</p>}
    </div>
  );
}
