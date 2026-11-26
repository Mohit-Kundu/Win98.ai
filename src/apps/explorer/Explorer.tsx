import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useContextProvider } from '../../ai/context';
import {
  actions,
  metadataService,
  organizeFiles,
  proposeOrganization,
  searchNatural,
  validateUpload,
  type AppError,
  type OrganizeMoveInput,
  type OrganizeProposal,
  type Result,
  type SearchHit,
  type SearchPlan,
} from '../../actions';
import { useFolder, type NodeRecord } from '../../actions/vfsHooks';
import type { AppProps } from '../../desktop/appRegistry';
import { ConfirmDialog, MessageBox, PromptDialog } from '../../ui/dialogs';
import { ContextMenu, type MenuCommand } from './ContextMenu';
import { FileList } from './FileList';
import { joinPath } from './fileTypes';
import { OrganizeProposalDialog } from './OrganizeProposalDialog';
import { FolderTree } from './FolderTree';
import { NewFolderIcon, OrganizeIcon, UploadIcon } from './ToolbarIcons';
import { PropertiesDialog } from './PropertiesDialog';
import { SearchBar, type SearchFilterValues } from './SearchBar';
import { SearchResults } from './SearchResults';
import './explorer.css';

type Modal =
  | { kind: 'message'; message: string }
  | { kind: 'newFolder' }
  | { kind: 'rename'; node: NodeRecord }
  | { kind: 'move'; node: NodeRecord }
  | { kind: 'delete'; node: NodeRecord }
  | { kind: 'overwrite'; name: string; bytes: ArrayBuffer; mime: string; path: string }
  | { kind: 'properties'; nodeId: string }
  | { kind: 'organize'; proposal: OrganizeProposal };

function initialFolderId(launchArgs: unknown): string | null {
  const id = (launchArgs as { folderId?: unknown } | undefined)?.folderId;
  return typeof id === 'string' ? id : null;
}

export function Explorer({ windowId, launchArgs }: AppProps) {
  const [rootId, setRootId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(initialFolderId(launchArgs));
  const [folderPath, setFolderPath] = useState('C:\\');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [search, setSearch] = useState<{ hits: SearchHit[]; plan: SearchPlan } | null>(null);
  const [searching, setSearching] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [organizing, setOrganizing] = useState(false);
  const searchSeq = useRef(0);

  const allItems = useFolder(folderId);
  // The Recycle Bin folder opens only from its own window.
  const items = useMemo(() => allItems.filter((n) => n.system !== 'recycleBin'), [allItems]);
  useContextProvider('explorer', windowId, () =>
    folderId === null ? undefined : { app: 'explorer', folderId, folderPath, selectedIds: selectedId ? [selectedId] : [] },
  );

  // Resolve the root folder once. Also the fallback when the shown folder disappears.
  useEffect(() => {
    void actions.listFolder({ path: 'C:\\' }).then((r) => {
      if (!r.ok) return;
      setRootId(r.value.folder.node.id);
      setFolderId((cur) => cur ?? r.value.folder.node.id);
    });
  }, []);

  // Keep the displayed path current (renames and moves change it) and recover from deletion.
  useEffect(() => {
    if (folderId === null || rootId === null) return;
    let cancelled = false;
    void actions.listFolder({ folderId }).then((r) => {
      if (cancelled) return;
      // A folder that was deleted now lives in the Recycle Bin, so leave it like a missing folder.
      if (r.ok && !/^C:\\Recycle Bin(\\|$)/i.test(r.value.folder.path)) setFolderPath(r.value.folder.path);
      else setFolderId(rootId);
    });
    return () => {
      cancelled = true;
    };
  }, [folderId, rootId, items]);

  const fail = useCallback((error: AppError) => setModal({ kind: 'message', message: error.message }), []);
  const check = useCallback(
    <T,>(r: Result<T>): r is { ok: true; value: T } => {
      if (!r.ok) fail(r.error);
      return r.ok;
    },
    [fail],
  );

  const selected = items.find((n) => n.id === selectedId) ?? null;

  const navigate = (id: string) => {
    setFolderId(id);
    setSelectedId(null);
  };

  const open = async (node: NodeRecord) => {
    if (node.kind === 'folder') return navigate(node.id);
    check(await actions.openFile({ fileId: node.id }));
  };

  const runSearch = async (query: string, filters: SearchFilterValues) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    const r = await searchNatural({ query, filters });
    if (seq !== searchSeq.current) return; // a newer search or Clear superseded this one
    setSearching(false);
    if (check(r)) setSearch(r.value);
  };

  const clearSearch = () => {
    searchSeq.current++;
    setSearching(false);
    setSearch(null);
  };

  const openHit = async (hit: SearchHit) => {
    if (hit.kind === 'folder') {
      clearSearch();
      return navigate(hit.id);
    }
    check(await actions.openFile({ fileId: hit.id }));
  };

  const runCommand = (cmd: MenuCommand) => {
    setMenu(null);
    if (!selected) return;
    if (cmd === 'open') void open(selected);
    else if (cmd === 'rename') setModal({ kind: 'rename', node: selected });
    else if (cmd === 'move') setModal({ kind: 'move', node: selected });
    else if (cmd === 'delete') setModal({ kind: 'delete', node: selected });
    else if (cmd === 'retry') metadataService.retry(selected.id);
    else setModal({ kind: 'properties', nodeId: selected.id });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!selected) return;
    if (e.key === 'Enter') void open(selected);
    else if (e.key === 'F2') setModal({ kind: 'rename', node: selected });
    else if (e.key === 'Delete') setModal({ kind: 'delete', node: selected });
  };

  const createFolder = async (name: string) => {
    setModal(null);
    if (folderId === null) return;
    check(await actions.createFolder({ parentId: folderId, name }));
  };

  const rename = async (node: NodeRecord, name: string) => {
    setModal(null);
    check(await actions.renameNode({ nodeId: node.id, name }));
  };

  const move = async (node: NodeRecord, destinationPath: string) => {
    setModal(null);
    check(await actions.moveNode({ nodeId: node.id, destinationPath }));
  };

  const remove = async (node: NodeRecord) => {
    setModal(null);
    if (check(await actions.deleteNode({ nodeId: node.id })) && node.id === selectedId) setSelectedId(null);
  };

  const save = async (path: string, bytes: ArrayBuffer, mime: string, overwrite: boolean) => {
    const r = await actions.saveFile({ path, bytes, mime, overwrite });
    if (!r.ok && r.error.code === 'CONFLICT_OVERWRITE') {
      setModal({ kind: 'overwrite', name: path, bytes, mime, path });
      return;
    }
    setModal(null);
    check(r);
  };

  /** Organize the selected file, the files in the selected folder, or the files in the current folder. */
  const startOrganize = async () => {
    if (folderId === null || organizing) return;
    setOrganizing(true);
    const r = await proposeOrganization(
      selected?.kind === 'file' ? { fileIds: [selected.id] } : { folderId: selected?.kind === 'folder' ? selected.id : folderId },
    );
    setOrganizing(false);
    if (check(r)) setModal({ kind: 'organize', proposal: r.value });
  };

  const applyOrganize = async (moves: OrganizeMoveInput[]) => {
    setModal(null);
    const r = await organizeFiles({ moves });
    if (!check(r)) return;
    const { moved, failed } = r.value;
    const lines = [`Moved ${moved.length} of ${moves.length} file(s).`, ...failed.slice(0, 5).map((f) => `Not moved: ${f.message}`)];
    if (failed.length > 5) lines.push(`...and ${failed.length - 5} more.`);
    setModal({ kind: 'message', message: lines.join('\n') });
  };

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const v = validateUpload(file.name, file.size);
    if (!v.ok) return fail(v.error);
    await save(joinPath(folderPath, file.name), await file.arrayBuffer(), file.type || 'application/octet-stream', false);
  };

  return (
    <div className="explorer">
      <div className="explorer-toolbar">
        <button type="button" className="explorer-tool-btn" onClick={() => setModal({ kind: 'newFolder' })}>
          <NewFolderIcon />
          <span>New Folder</span>
        </button>
        <button type="button" className="explorer-tool-btn" onClick={() => fileInput.current?.click()}>
          <UploadIcon />
          <span>Upload</span>
        </button>
        <button type="button" className="explorer-tool-btn" disabled={organizing} onClick={() => void startOrganize()}>
          <OrganizeIcon />
          <span>{organizing ? 'Organizing...' : 'Organize with AI'}</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          aria-label="Upload file"
          accept=".pdf,.txt,.md,.png,.jpg,.jpeg"
          onChange={(e) => void onUpload(e)}
        />
        <span className="explorer-path" aria-label="Current folder">
          {folderPath}
        </span>
        <SearchBar busy={searching} active={search !== null} onSearch={(q, f) => void runSearch(q, f)} onClear={clearSearch} />
      </div>
      <div className="explorer-body">
        {rootId && (
          <div className="explorer-tree-pane sunken-panel">
            <FolderTree rootId={rootId} selectedId={folderId} onSelect={navigate} />
          </div>
        )}
        {search ? (
          <SearchResults hits={search.hits} onOpen={(h) => void openHit(h)} />
        ) : (
          <FileList
            items={items}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={(n) => void open(n)}
            onContextMenu={(_n, x, y) => setMenu({ x, y })}
            onKeyDown={onKeyDown}
          />
        )}
      </div>
      <div className="status-bar">
        <p className="status-bar-field">
          {search
            ? `${search.hits.length} result(s)${search.plan.source === 'fallback' ? ' (keyword search)' : ''}`
            : `${items.length} object(s)`}
        </p>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} canRetry={selected?.meta.aiStatus === 'error'} onCommand={runCommand} onClose={() => setMenu(null)} />}

      {modal?.kind === 'message' && <MessageBox title="Explorer" message={modal.message} onClose={() => setModal(null)} />}
      {modal?.kind === 'newFolder' && (
        <PromptDialog title="New Folder" label="Folder name:" initialValue="New Folder" onSubmit={(n) => void createFolder(n)} onCancel={() => setModal(null)} />
      )}
      {modal?.kind === 'rename' && (
        <PromptDialog title="Rename" label="New name:" initialValue={modal.node.name} onSubmit={(n) => void rename(modal.node, n)} onCancel={() => setModal(null)} />
      )}
      {modal?.kind === 'move' && (
        <PromptDialog title="Move to" label="Destination folder path:" initialValue="C:\" onSubmit={(p) => void move(modal.node, p)} onCancel={() => setModal(null)} />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmDialog
          title="Confirm Delete"
          message={`Are you sure you want to move "${modal.node.name}"${modal.node.kind === 'folder' ? ' and everything in it' : ''} to the Recycle Bin?`}
          onConfirm={() => void remove(modal.node)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === 'overwrite' && (
        <ConfirmDialog
          title="Confirm Overwrite"
          message={`"${modal.name}" already exists. Do you want to replace it?`}
          onConfirm={() => void save(modal.path, modal.bytes, modal.mime, true)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === 'organize' && (
        <OrganizeProposalDialog
          moves={modal.proposal.moves}
          skipped={modal.proposal.rejected + modal.proposal.unchanged}
          onConfirm={(m) => void applyOrganize(m)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === 'properties' && <PropertiesDialog nodeId={modal.nodeId} onClose={() => setModal(null)} />}
    </div>
  );
}
