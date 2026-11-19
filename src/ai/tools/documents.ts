import { z } from 'zod';
import { ok } from '../../../shared/errors';
import { defineTool } from '../registry';
import { capText, contentHtmlSchema, overwriteSchema, pathSchema } from './shared';

export const readDocument = defineTool({
  name: 'read_document',
  description: 'Read a WordPad (.wpd), TXT, or MD file as plain text (first 4 KB). Returns the file id for later calls.',
  input: z
    .object({ path: z.string().min(1).optional(), fileId: z.string().min(1).optional() })
    .refine((a) => a.path !== undefined || a.fileId !== undefined, 'Provide path or fileId.'),
  async handler(args, { actions }) {
    const r = await actions.readDocument({ fileId: args.fileId, path: args.fileId ? undefined : args.path });
    if (!r.ok) return r;
    const { text, truncated } = capText(r.value.text);
    return ok({ fileId: r.value.fileId, path: r.value.path, text, truncated });
  },
});

export const createDocument = defineTool({
  name: 'create_document',
  description: 'Create a WordPad document (.wpd) with HTML content and save it. Returns the file id and path.',
  input: z.object({
    path: pathSchema('Full path ending in .wpd, for example C:\\My Documents\\Report.wpd.'),
    contentHtml: contentHtmlSchema.optional(),
    overwrite: overwriteSchema,
  }),
  destructive: (a) => a.overwrite === true,
  describeForConfirm: (a) => `Replace the existing file ${a.path}?`,
  async handler(args, { actions }) {
    const r = await actions.createDocument({ path: args.path, contentHtml: args.contentHtml, overwrite: args.overwrite });
    return r.ok ? ok({ fileId: r.value.fileId, path: r.value.path }) : r;
  },
});

export const updateDocument = defineTool({
  name: 'update_document',
  description:
    'Change a WordPad document. Modes: append (add to the end), replace (whole document), replaceSection (content under a heading, needs section), replaceSelection (needs from and to).',
  input: z.object({
    fileId: z.string().min(1),
    mode: z.enum(['replace', 'append', 'replaceSelection', 'replaceSection']),
    contentHtml: contentHtmlSchema,
    section: z.string().min(1).optional().describe('Heading text for replaceSection.'),
    from: z.number().int().min(0).optional().describe('Selection start for replaceSelection.'),
    to: z.number().int().min(0).optional().describe('Selection end for replaceSelection.'),
  }),
  destructive: (a) => a.mode !== 'append',
  describeForConfirm: (a) => `Overwrite content of the document (${a.mode})?`,
  async handler(args, { actions }) {
    const range = args.from !== undefined && args.to !== undefined ? { from: args.from, to: args.to } : undefined;
    const r = await actions.updateDocument({ fileId: args.fileId, mode: args.mode, contentHtml: args.contentHtml, section: args.section, range });
    return r.ok ? ok({ fileId: r.value.fileId }) : r;
  },
});

export const insertImageIntoDocument = defineTool({
  name: 'insert_image_into_document',
  description: 'Insert an image already saved in the filesystem into a WordPad document. Position defaults to the end.',
  input: z.object({
    documentId: z.string().min(1),
    imageId: z.string().min(1).describe('File id of a PNG or JPG, for example from generate_image.'),
    position: z
      .object({
        afterHeading: z.string().min(1).optional().describe('Insert right after the heading with this text.'),
        pos: z.number().int().min(0).optional().describe('Raw document position.'),
      })
      .optional(),
    alt: z.string().max(300).optional(),
  }),
  async handler(args, { actions }) {
    const p = args.position;
    const position = p?.afterHeading !== undefined ? { afterHeading: p.afterHeading } : p?.pos !== undefined ? { pos: p.pos } : ('end' as const);
    const r = await actions.insertImageIntoDocument({ documentId: args.documentId, imageId: args.imageId, position, alt: args.alt });
    return r.ok ? ok({ documentId: r.value.documentId }) : r;
  },
});
