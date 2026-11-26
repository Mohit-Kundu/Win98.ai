import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SearchFilesInput } from '../../actions';

export type SearchFilterValues = Omit<SearchFilesInput, 'text' | 'limit'>;

const TYPES: Array<[string, string]> = [
  ['', 'Any type'],
  ['wpd', 'WordPad document'],
  ['txt', 'Text'],
  ['md', 'Markdown'],
  ['pdf', 'PDF'],
  ['png', 'PNG image'],
  ['jpg', 'JPEG image'],
  ['folder', 'Folder'],
];
const DAY = 86_400_000;
const SPANS: Array<[string, string, number]> = [
  ['', 'Any time', 0],
  ['day', 'Past day', DAY],
  ['week', 'Past week', 7 * DAY],
  ['month', 'Past month', 30 * DAY],
];
const spanMs = (key: string): number => SPANS.find((s) => s[0] === key)?.[2] ?? 0;

export function SearchBar({ busy, onSearch, onClear, active }: {
  busy: boolean;
  active: boolean;
  onSearch: (query: string, filters: SearchFilterValues) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [created, setCreated] = useState('');
  const [modified, setModified] = useState('');
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!open) return;
    const shut = () => {
      setOpen(false);
      setSub(null);
    };
    const close = (e: Event) => {
      if (e.target instanceof Node && formRef.current?.contains(e.target)) return;
      shut();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shut();
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const activeCount = [type, created, modified].filter(Boolean).length;

  const spanOptions = (prefix: string): Array<[string, string]> =>
    SPANS.map(([v, label]) => [v, v ? `${prefix}: ${label}` : `${prefix}: any time`]);
  const groups = [
    { key: 'type', label: 'File type', value: type, set: setType, options: TYPES },
    { key: 'created', label: 'Created', value: created, set: setCreated, options: spanOptions('Created') },
    { key: 'modified', label: 'Modified', value: modified, set: setModified, options: spanOptions('Modified') },
  ];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOpen(false);
    const now = Date.now();
    const filters: SearchFilterValues = {
      ...(type ? { type: type as SearchFilterValues['type'] } : {}),
      ...(created ? { createdAfter: now - spanMs(created) } : {}),
      ...(modified ? { modifiedAfter: now - spanMs(modified) } : {}),
    };
    onSearch(query, filters);
  };

  const clear = () => {
    setQuery('');
    setType('');
    setCreated('');
    setModified('');
    setOpen(false);
    onClear();
  };

  return (
    <form ref={formRef} className="explorer-search" role="search" aria-label="Search files" onSubmit={submit}>
      <input
        type="search"
        aria-label="Search query"
        placeholder="Search files, e.g. the document about machine learning"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Searching...' : 'Search'}
      </button>
      <span className="explorer-filter-wrap">
        <button
          type="button"
          className="explorer-tool-btn explorer-filter-btn"
          aria-label="Filters"
          aria-haspopup="true"
          aria-expanded={open}
          title={activeCount ? `Filters (${activeCount} active)` : 'Filters'}
          onClick={() => {
            setOpen((o) => !o);
            setSub(null);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1 1h12L8.5 7v5.5l-3-1.5V7z" fill={activeCount ? '#000080' : '#808080'} stroke="#000" strokeLinejoin="round" />
          </svg>
            <span>{activeCount > 0 ? `Filter (${activeCount})` : 'Filter'}</span>
        </button>
        {open && (
          <div className="explorer-filter-pop" role="menu" aria-label="Filters">
            {groups.map((g) => (
              <div
                key={g.key}
                className="explorer-menu-item"
                onMouseEnter={() => setSub(g.key)}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="true"
                  aria-expanded={sub === g.key}
                  onClick={() => setSub(sub === g.key ? null : g.key)}
                >
                  <span>{g.label}</span>
                  <span aria-hidden="true">▸</span>
                </button>
                {sub === g.key && (
                  <div className="explorer-filter-sub" role="menu" aria-label={g.label}>
                    {g.options.map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        role="menuitemradio"
                        aria-checked={g.value === v}
                        onClick={() => {
                          g.set(v);
                          setOpen(false);
                          setSub(null);
                        }}
                      >
                        <span aria-hidden="true">{g.value === v ? '●' : ''}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </span>
      {active && (
        <button type="button" onClick={clear}>
          Clear
        </button>
      )}
    </form>
  );
}
