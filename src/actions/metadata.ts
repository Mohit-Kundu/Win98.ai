import { err, ok, type Result } from '../../shared/errors';
import type { VfsService } from '../vfs/service';
import type { NodeInfo, NodeMeta } from './types';

export interface UpdateMetadataInput {
  nodeId?: string;
  path?: string;
  cwd?: string;
  /** Fields to change. Omitted fields are kept. */
  patch: Partial<NodeMeta>;
}

export interface MetadataActions {
  updateMetadata(i: UpdateMetadataInput): Promise<Result<NodeInfo>>;
}

/** Metadata editing (notes and AI fields). Kept apart from core.ts so it can evolve independently. */
export function createMetadataActions({ vfs }: { vfs: VfsService }): MetadataActions {
  return {
    async updateMetadata(i) {
      try {
        if (!i || typeof i.patch !== 'object' || i.patch === null) {
          return err('VALIDATION', 'A metadata patch is required.');
        }
        let id = i.nodeId;
        if (id === undefined) {
          if (i.path === undefined) return err('VALIDATION', 'Provide a node id or a path.');
          const r = await vfs.resolve(i.path, i.cwd);
          if (!r.ok) return r;
          id = r.value.id;
        }
        const updated = await vfs.updateMeta(id, i.patch);
        if (!updated.ok) return updated;
        return ok({ node: updated.value, path: await vfs.pathOf(updated.value.id) });
      } catch (e) {
        return err('WRITE_FAILED', 'The operation failed unexpectedly.', {
          cause: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
}
