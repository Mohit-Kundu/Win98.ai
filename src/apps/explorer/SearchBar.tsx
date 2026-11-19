import { useState, type FormEvent } from 'react';
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
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
    onClear();
  };

  return (
    <form className="explorer-search" role="search" aria-label="Search files" onSubmit={submit}>
      <input
        type="search"
        aria-label="Search query"
        placeholder="Search files, e.g. the document about machine learning"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select aria-label="File type" value={type} onChange={(e) => setType(e.target.value)}>
        {TYPES.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <select aria-label="Created" value={created} onChange={(e) => setCreated(e.target.value)}>
        {SPANS.map(([v, label]) => (
          <option key={v} value={v}>
            {v ? `Created: ${label}` : 'Created: any time'}
          </option>
        ))}
      </select>
      <select aria-label="Modified" value={modified} onChange={(e) => setModified(e.target.value)}>
        {SPANS.map(([v, label]) => (
          <option key={v} value={v}>
            {v ? `Modified: ${label}` : 'Modified: any time'}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy}>
        {busy ? 'Searching...' : 'Search'}
      </button>
      {active && (
        <button type="button" onClick={clear}>
          Clear
        </button>
      )}
    </form>
  );
}
