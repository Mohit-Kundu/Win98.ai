import { z } from 'zod';
import { FILE_TYPES } from '../../../shared/api-contracts';
import { err, ok } from '../../../shared/errors';
import { defineTool } from '../registry';
import { MAX_LIST_ENTRIES, capText, pathSchema, summarizeNode } from './shared';

const target = {
  path: z.string().min(1).optional().describe('Full path such as C:\\My Documents\\Notes.txt.'),
  fileId: z.string().min(1).optional().describe('Stable file or folder id returned by an earlier tool.'),
};
const needTarget = (a: { path?: string; fileId?: string }) => a.path !== undefined || a.fileId !== undefined;
const TARGET_MSG = 'Provide path or fileId.';

const dateArg = (what: string) =>
  z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Use an ISO 8601 date such as 2025-06-17.')
    .optional()
    .describe(what);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const afterMs = (s?: string): number | undefined => (s === undefined ? undefined : Date.parse(s));
/** A date without a time includes that whole day when used as an upper bound. */
const beforeMs = (s?: string): number | undefined => (s === undefined ? undefined : Date.parse(s) + (DATE_ONLY.test(s) ? DAY_MS - 1 : 0));

export const searchFiles = defineTool({
  name: 'search_files',
  description:
    'Search files and folders by keywords, file type, and created or modified dates. Matches names, text, PDF text, AI title, description, category, tags, and notes. Returns at most 50 hits ranked by relevance.',
  input: z
    .object({
      text: z.string().max(500).optional().describe('Keywords such as "machine learning". Leave out words about dates or file types.'),
      type: z.enum(FILE_TYPES).optional().describe('Restrict to one file type, or folder.'),
      createdAfter: dateArg('Only items created on or after this ISO 8601 date.'),
      createdBefore: dateArg('Only items created on or before this ISO 8601 date.'),
      modifiedAfter: dateArg('Only items modified on or after this ISO 8601 date.'),
      modifiedBefore: dateArg('Only items modified on or before this ISO 8601 date.'),
    })
    .refine(
      (a) => (a.text ?? '').trim() !== '' || a.type !== undefined || [a.createdAfter, a.createdBefore, a.modifiedAfter, a.modifiedBefore].some((v) => v !== undefined),
      'Provide text or at least one filter.',
    ),
  async handler(args, { actions }) {
    const r = await actions.searchFiles({
      text: args.text,
      type: args.type,
      createdAfter: afterMs(args.createdAfter),
      createdBefore: beforeMs(args.createdBefore),
      modifiedAfter: afterMs(args.modifiedAfter),
      modifiedBefore: beforeMs(args.modifiedBefore),
      limit: MAX_LIST_ENTRIES,
    });
    if (!r.ok) return r;
    return ok({
      total: r.value.length,
      truncated: r.value.length >= MAX_LIST_ENTRIES,
      hits: r.value.slice(0, MAX_LIST_ENTRIES).map((h) => ({
        id: h.id,
        name: h.name,
        path: h.path,
        type: h.type,
        title: h.title,
        description: capText(h.description, 400).text,
        category: h.category,
        createdAt: h.createdAt,
        modifiedAt: h.modifiedAt,
      })),
    });
  },
});

const MAX_ORGANIZE_MOVES = 50;
const baseName = (p: string): string => p.slice(p.lastIndexOf('\\') + 1) || p;

export const organizeFiles = defineTool({
  name: 'organize_files',
  description:
    'Move several files into folders in one step, creating missing destination folders. Give each file by path or fileId and the full destination folder path. Prefer existing folders. The user sees every move and is asked to confirm. Returns the moves that were made and any that failed.',
  input: z.object({
    moves: z
      .array(
        z
          .object({
            ...target,
            destinationPath: pathSchema('Full path of the destination folder, for example C:\\My Documents\\Reports.'),
          })
          .refine(needTarget, TARGET_MSG),
      )
      .min(1)
      .max(MAX_ORGANIZE_MOVES),
  }),
  destructive: true,
  describeForConfirm: (a) => {
    const lines = a.moves.slice(0, 20).map((m) => `${m.path ? baseName(m.path) : `item ${m.fileId}`} \u2192 ${m.destinationPath}`);
    const more = a.moves.length > 20 ? `\n...and ${a.moves.length - 20} more` : '';
    return `Move ${a.moves.length} file(s)?\n${lines.join('\n')}${more}`;
  },
  async handler(args, { actions }) {
    const r = await actions.organizeFiles({
      moves: args.moves.map((m) => ({ fileId: m.fileId, path: m.fileId ? undefined : m.path, destinationPath: m.destinationPath })),
    });
    if (!r.ok) return r;
    const { moved, failed } = r.value;
    // A partly failed batch is reported as a failure so it is never presented as complete success.
    if (failed.length > 0) {
      return err('WRITE_FAILED', `${failed.length} of ${args.moves.length} move(s) failed. ${moved.length} file(s) were moved.`, { moved, failed });
    }
    return ok({ movedCount: moved.length, moved: moved.map((m) => ({ fileId: m.fileId, to: m.to })) });
  },
});

export const listFolder = defineTool({
  name: 'list_folder',
  description: 'List the files and folders inside a folder. Returns at most 50 entries.',
  input: z.object({
    path: z.string().min(1).optional().describe('Folder path. Defaults to C:\\ when neither path nor folderId is given.'),
    folderId: z.string().min(1).optional(),
  }),
  async handler(args, { actions }) {
    const r = await actions.listFolder({ path: args.folderId ? undefined : (args.path ?? 'C:\\'), folderId: args.folderId });
    if (!r.ok) return r;
    const items = r.value.items;
    return ok({
      folder: { id: r.value.folder.node.id, path: r.value.folder.path },
      total: items.length,
      truncated: items.length > MAX_LIST_ENTRIES,
      items: items.slice(0, MAX_LIST_ENTRIES).map(summarizeNode),
    });
  },
});

export const createFolder = defineTool({
  name: 'create_folder',
  description: 'Create a folder at the given full path. The parent folder must exist.',
  input: z.object({ path: pathSchema('Full path of the new folder, for example C:\\My Documents\\AI Research.') }),
  async handler(args, { actions }) {
    const r = await actions.createFolder({ path: args.path });
    return r.ok ? ok({ id: r.value.node.id, path: r.value.path }) : r;
  },
});

export const readFileMetadata = defineTool({
  name: 'read_file_metadata',
  description: 'Read name, size, timestamps, AI title, description, category, tags, and user notes of a file or folder.',
  input: z.object(target).refine(needTarget, TARGET_MSG),
  async handler(args, { actions }) {
    const r = await actions.readMetadata({ nodeId: args.fileId, path: args.fileId ? undefined : args.path });
    if (!r.ok) return r;
    const { node, path, meta } = r.value;
    const description = capText(meta.description ?? '');
    const notes = capText(meta.notes ?? '');
    return ok({
      ...summarizeNode(node),
      path,
      title: meta.title,
      description: description.text,
      category: meta.category,
      tags: (meta.tags ?? []).slice(0, MAX_LIST_ENTRIES),
      notes: notes.text,
      aiStatus: meta.aiStatus,
      truncated: description.truncated || notes.truncated,
    });
  },
});

export const deleteNode = defineTool({
  name: 'delete_node',
  description:
    'Move a file or folder (with everything inside) to the Recycle Bin. The user can restore it later. Items already in the Recycle Bin are deleted permanently. Applications cannot be deleted. The user is asked to confirm.',
  input: z.object(target).refine(needTarget, TARGET_MSG),
  destructive: true,
  describeForConfirm: (a) => `Move ${a.path ?? `item ${a.fileId}`} to the Recycle Bin?`,
  async handler(args, { actions }) {
    const r = await actions.deleteNode({ nodeId: args.fileId, path: args.fileId ? undefined : args.path });
    return r.ok ? ok({ path: r.value.path, removedCount: r.value.removedIds.length, permanent: r.value.permanent === true }) : r;
  },
});

export const renameNode = defineTool({
  name: 'rename_node',
  description: 'Rename a file or folder in place. newName is the new name only, not a path.',
  input: z.object({ ...target, newName: z.string().min(1) }).refine(needTarget, TARGET_MSG),
  async handler(args, { actions }) {
    const r = await actions.renameNode({ nodeId: args.fileId, path: args.fileId ? undefined : args.path, name: args.newName });
    return r.ok ? ok({ id: r.value.node.id, path: r.value.path }) : r;
  },
});

export const moveNode = defineTool({
  name: 'move_node',
  description: 'Move a file or folder into another folder, optionally under a new name.',
  input: z
    .object({ ...target, destinationPath: pathSchema('Full path of the destination folder.'), newName: z.string().min(1).optional() })
    .refine(needTarget, TARGET_MSG),
  async handler(args, { actions }) {
    const r = await actions.moveNode({
      nodeId: args.fileId,
      path: args.fileId ? undefined : args.path,
      destinationPath: args.destinationPath,
      newName: args.newName,
    });
    return r.ok ? ok({ id: r.value.node.id, path: r.value.path }) : r;
  },
});

export const openFile = defineTool({
  name: 'open_file',
  description: 'Open a file in its associated application (images in Paint, documents in WordPad).',
  input: z.object(target).refine(needTarget, TARGET_MSG),
  async handler(args, { actions }) {
    const r = await actions.openFile({ fileId: args.fileId, path: args.fileId ? undefined : args.path });
    return r.ok ? ok({ windowId: r.value.windowId, appId: r.value.appId }) : r;
  },
});

export const openApplication = defineTool({
  name: 'open_application',
  description: 'Open an application window by id: explorer, paint, wordpad, or cmd.',
  input: z.object({ appId: z.enum(['explorer', 'paint', 'wordpad', 'cmd']) }),
  async handler(args, { actions }) {
    const r = await actions.openApplication({ appId: args.appId });
    return r.ok ? ok({ windowId: r.value.windowId }) : r;
  },
});

export const runCommand = defineTool({
  name: 'run_command',
  description: 'Run a CMD command (dir, cd, mkdir, cls, help). Returns its printed output.',
  input: z.object({
    line: z.string().min(1).max(500).describe('The command line, for example: dir "C:\\My Documents".'),
    cwd: z.string().min(1).optional().describe('Working directory. Defaults to C:\\.'),
  }),
  appScope: ['cmd'],
  async handler(args, { actions }) {
    const r = await actions.executeCommand({ line: args.line, cwd: args.cwd ?? 'C:\\' });
    if (!r.ok) return r;
    const joined = capText(r.value.output.join('\n'));
    return ok({ output: joined.text, truncated: joined.truncated, cwd: r.value.cwd });
  },
});
