import type { OrganizeFile, OrganizeRequest, OrganizeResponse } from '../../shared/api-contracts';
import { err, ok, type Result } from '../../shared/errors';
import { aiClient } from '../ai/client';
import { MAX_NAME_LENGTH, ROOT_DISPLAY, formatPath, resolveSegments } from '../vfs/paths';
import { vfs as sharedVfs, type VfsService } from '../vfs/service';
import type { NodeRecord } from './types';

/** Auto-organize (Req 4.5-4.7). Proposing never changes the VFS. Applying creates folders and moves files. */
export const MAX_ORGANIZE_FILES = 100;
const MAX_FOLDERS_SENT = 1000;

export interface ProposeOrganizationInput {
  /** Files to organize. Folders in this list are ignored. */
  fileIds?: string[];
  /** Organize the files directly inside this folder. */
  folderId?: string;
}

export interface OrganizeMoveProposal {
  fileId: string;
  name: string;
  /** Folder path the file is in now. */
  from: string;
  /** Destination folder path, canonicalized against existing folders. */
  destination: string;
  /** True when the destination folder does not exist yet and will be created. */
  newFolder: boolean;
}

export interface OrganizeProposal {
  moves: OrganizeMoveProposal[];
  /** Suggestions dropped because the destination was unsafe, the file was unknown, or it was a duplicate. */
  rejected: number;
  /** Suggestions dropped because the file is already in the suggested folder. */
  unchanged: number;
}

export interface OrganizeMoveInput {
  fileId?: string;
  path?: string;
  destinationPath: string;
}

export interface OrganizeFilesInput {
  moves: OrganizeMoveInput[];
}

export interface OrganizeFilesOutput {
  moved: Array<{ fileId: string; from: string; to: string }>;
  failed: Array<{ fileId?: string; path?: string; code: string; message: string }>;
}

export interface OrganizeActions {
  /** Applies moves one by one. Reports per-move results; a failed move does not stop the others. */
  organizeFiles(i: OrganizeFilesInput): Promise<Result<OrganizeFilesOutput>>;
}

export interface OrganizeService extends OrganizeActions {
  proposeOrganization(i: ProposeOrganizationInput): Promise<Result<OrganizeProposal>>;
}

export interface OrganizeDeps {
  vfs?: VfsService;
  ai?: { organize(req: OrganizeRequest): Promise<Result<OrganizeResponse>> };
}

// Characters that cannot appear in a name (`:` is handled for the drive prefix before this runs).
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Turn a model-suggested destination into folder-name segments under C:\.
 * Returns undefined when the path is unsafe (other drive, `..`) or names nothing.
 */
export function sanitizeDestination(raw: string): string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  let rest = raw.trim();
  const drive = /^([a-zA-Z]):/.exec(rest);
  if (drive) {
    if (drive[1]!.toUpperCase() !== 'C') return undefined;
    rest = rest.slice(2);
  }
  const out: string[] = [];
  for (const seg of rest.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return undefined;
    const clean = seg.replace(BAD_CHARS, '').trim().replace(/\.+$/, '').trim().slice(0, MAX_NAME_LENGTH).trim();
    if (clean === '' || clean === '.' || clean === '..') return undefined;
    out.push(clean);
  }
  return out.length === 0 ? undefined : out;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createOrganizeService(deps: OrganizeDeps = {}): OrganizeService {
  const vfs = deps.vfs ?? sharedVfs;
  const ai = deps.ai ?? { organize: (r: OrganizeRequest) => aiClient.organize(r) };

  /** Every folder path (breadth first, capped) mapped from lowercase path to its real spelling. */
  const folderMap = async (): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    const root = await vfs.resolve(ROOT_DISPLAY);
    if (!root.ok) return map;
    const queue: Array<{ id: string; segs: string[] }> = [{ id: root.value.id, segs: [] }];
    while (queue.length > 0 && map.size < MAX_FOLDERS_SENT) {
      const cur = queue.shift()!;
      for (const child of await vfs.list(cur.id)) {
        if (child.kind !== 'folder') continue;
        const segs = [...cur.segs, child.name];
        const path = formatPath(segs);
        map.set(path.toLowerCase(), path);
        queue.push({ id: child.id, segs });
      }
    }
    return map;
  };

  /** Reuse the spelling of existing folders at every level of the path (case-insensitive). */
  const canonical = (segs: string[], existing: Map<string, string>): { path: string; isNew: boolean } => {
    const out: string[] = [];
    let isNew = false;
    for (const seg of segs) {
      const probe = formatPath([...out, seg]);
      const hit = existing.get(probe.toLowerCase());
      if (hit) out.push(hit.slice(hit.lastIndexOf('\\') + 1));
      else {
        out.push(seg);
        isNew = true;
      }
    }
    return { path: formatPath(out), isNew };
  };

  const filesFor = async (i: ProposeOrganizationInput): Promise<Result<NodeRecord[]>> => {
    const nodes: NodeRecord[] = [];
    if (i.folderId !== undefined) {
      const folder = await vfs.get(i.folderId);
      if (!folder || folder.kind !== 'folder') return err('NOT_FOUND', 'The folder was not found.', { id: i.folderId });
      nodes.push(...(await vfs.list(folder.id)));
    }
    for (const id of i.fileIds ?? []) {
      const n = await vfs.get(id);
      if (n) nodes.push(n);
    }
    const seen = new Set<string>();
    const files = nodes.filter((n) => n.kind === 'file' && !seen.has(n.id) && seen.add(n.id));
    if (files.length === 0) return err('VALIDATION', 'There are no files to organize.');
    if (files.length > MAX_ORGANIZE_FILES) {
      return err('LIMIT_REACHED', `Select at most ${MAX_ORGANIZE_FILES} files to organize at once.`);
    }
    return ok(files);
  };

  const parentPathOf = (path: string): string => {
    const cut = path.lastIndexOf('\\');
    return cut <= 2 ? ROOT_DISPLAY : path.slice(0, cut);
  };

  const proposeOrganization: OrganizeService['proposeOrganization'] = async (i) => {
    try {
      const files = await filesFor(i ?? {});
      if (!files.ok) return files;
      const existing = await folderMap();
      // Only names and generated metadata go to the model, never file content.
      const sent: OrganizeFile[] = files.value.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.ext ?? 'file',
        ...(n.meta.title ? { title: n.meta.title } : {}),
        ...(n.meta.description ? { description: n.meta.description.slice(0, 500) } : {}),
        ...(n.meta.category ? { category: n.meta.category } : {}),
        ...(n.meta.tags?.length ? { tags: n.meta.tags.slice(0, 20) } : {}),
      }));
      const r = await ai.organize({ files: sent, folders: [...existing.values()] });
      if (!r.ok) return r;

      const byId = new Map(files.value.map((n) => [n.id, n]));
      const moves: OrganizeMoveProposal[] = [];
      const done = new Set<string>();
      let rejected = 0;
      let unchanged = 0;
      for (const m of r.value.moves) {
        const node = byId.get(m.fileId);
        const segs = sanitizeDestination(m.destination);
        if (!node || !segs || done.has(m.fileId)) {
          rejected++;
          continue;
        }
        done.add(m.fileId);
        const dest = canonical(segs, existing);
        const from = parentPathOf(await vfs.pathOf(node.id));
        if (dest.path.toLowerCase() === from.toLowerCase()) {
          unchanged++;
          continue;
        }
        moves.push({ fileId: node.id, name: node.name, from, destination: dest.path, newFolder: dest.isNew });
      }
      return ok({ moves, rejected, unchanged });
    } catch (e) {
      return err('WRITE_FAILED', 'Organizing failed unexpectedly.', { cause: message(e) });
    }
  };

  /** Find or create the folder for a list of segments. Creates only the missing levels. */
  const ensureFolder = async (segs: string[]): Promise<Result<NodeRecord>> => {
    let cur = await vfs.resolve(ROOT_DISPLAY);
    if (!cur.ok) return cur;
    const walked: string[] = [];
    for (const seg of segs) {
      walked.push(seg);
      const next = await vfs.resolve(formatPath(walked));
      if (next.ok) {
        if (next.value.kind !== 'folder') return err('INVALID_PATH', `"${formatPath(walked)}" is a file, not a folder.`);
        cur = next;
        continue;
      }
      if (next.error.code !== 'NOT_FOUND') return next;
      const made = await vfs.create({ parentId: cur.value.id, name: seg, kind: 'folder' });
      if (!made.ok) return made;
      cur = made;
    }
    return cur;
  };

  const organizeFiles: OrganizeActions['organizeFiles'] = async (i) => {
    try {
      if (!Array.isArray(i?.moves) || i.moves.length === 0) return err('VALIDATION', 'Provide at least one move.');
      const out: OrganizeFilesOutput = { moved: [], failed: [] };
      for (const m of i.moves) {
        const fail = (code: string, msg: string) => out.failed.push({ fileId: m.fileId, path: m.path, code, message: msg });
        const node = m.fileId !== undefined ? await vfs.get(m.fileId) : undefined;
        const target = node ? ok(node) : m.path !== undefined && m.fileId === undefined ? await vfs.resolve(m.path) : err('NOT_FOUND', 'The file was not found.');
        if (!target.ok) {
          fail(target.error.code, target.error.message);
          continue;
        }
        if (target.value.kind !== 'file') {
          fail('INVALID_MOVE', `"${target.value.name}" is a folder. Only files can be organized.`);
          continue;
        }
        // Strict here: an edited or model-written destination that climbs out of the root is refused, not repaired.
        const segs = resolveSegments(typeof m.destinationPath === 'string' ? m.destinationPath : '');
        if (!segs.ok || segs.value.length === 0) {
          fail(segs.ok ? 'INVALID_PATH' : segs.error.code, segs.ok ? 'Choose a destination folder below C:\\.' : segs.error.message);
          continue;
        }
        const from = parentPathOf(await vfs.pathOf(target.value.id));
        const dest = await ensureFolder(segs.value);
        if (!dest.ok) {
          fail(dest.error.code, dest.error.message);
          continue;
        }
        if (dest.value.id === target.value.parentId) continue; // already there: nothing to do, not a failure
        const moved = await vfs.move(target.value.id, dest.value.id);
        if (!moved.ok) {
          fail(moved.error.code, moved.error.message);
          continue;
        }
        out.moved.push({ fileId: target.value.id, from, to: await vfs.pathOf(moved.value.id) });
      }
      return ok(out);
    } catch (e) {
      return err('WRITE_FAILED', 'Organizing failed unexpectedly.', { cause: message(e) });
    }
  };

  return { proposeOrganization, organizeFiles };
}
