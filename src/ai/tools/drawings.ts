import { z } from 'zod';
import { ok } from '../../../shared/errors';
import { defineTool } from '../registry';
import { overwriteSchema, pathSchema } from './shared';

export const generateImage = defineTool({
  name: 'generate_image',
  description:
    'Generate an image from a text prompt and save it as a PNG. Returns only the file id and path. Pass the file id to insert_image_into_document.',
  input: z.object({
    prompt: z.string().trim().min(1).max(2000),
    path: z.string().min(1).optional().describe('Target PNG path. Defaults to a file in C:\\My Pictures.'),
    aspect: z.enum(['1:1', '4:3', '16:9']).optional(),
    overwrite: overwriteSchema,
  }),
  destructive: (a) => a.overwrite === true,
  describeForConfirm: (a) => `Replace the existing image ${a.path ?? ''}?`,
  async handler(args, { actions, signal }) {
    const r = await actions.generateImage({ prompt: args.prompt, path: args.path, aspect: args.aspect, overwrite: args.overwrite, signal });
    return r.ok ? ok({ fileId: r.value.fileId, path: r.value.path }) : r;
  },
});

export const createDrawing = defineTool({
  name: 'create_drawing',
  description: 'Create a blank PNG drawing of the given size.',
  input: z.object({
    path: pathSchema('Full path ending in .png.'),
    width: z.number().int().min(1).max(2048).optional(),
    height: z.number().int().min(1).max(2048).optional(),
    overwrite: overwriteSchema,
  }),
  destructive: (a) => a.overwrite === true,
  describeForConfirm: (a) => `Replace the existing drawing ${a.path}?`,
  async handler(args, { actions }) {
    const r = await actions.createDrawing({ path: args.path, width: args.width, height: args.height, overwrite: args.overwrite });
    return r.ok ? ok({ fileId: r.value.fileId, path: r.value.path }) : r;
  },
});

export const updateDrawing = defineTool({
  name: 'update_drawing',
  description: 'Replace the pixels of an existing PNG or JPG drawing with new base64 image data of the same format.',
  input: z.object({ fileId: z.string().min(1), imageBase64: z.string().min(1) }),
  appScope: ['paint'],
  destructive: true,
  describeForConfirm: () => 'Overwrite the current drawing with new image data?',
  async handler(args, { actions }) {
    const r = await actions.updateDrawing({ fileId: args.fileId, imageBase64: args.imageBase64 });
    return r.ok ? ok({ fileId: r.value.fileId }) : r;
  },
});
