import { useState } from 'react';
import type { OrganizeMoveInput, OrganizeMoveProposal } from '../../actions';
import { ModalDialog } from '../../ui/dialogs';

interface Row extends OrganizeMoveProposal {
  checked: boolean;
}

/**
 * Shows the AI's proposed moves. The user can untick a row or edit its destination before confirming.
 * Cancel (or closing) moves nothing (Req 4.7).
 */
export function OrganizeProposalDialog({
  moves,
  skipped = 0,
  onConfirm,
  onCancel,
}: {
  moves: OrganizeMoveProposal[];
  /** Suggestions that were dropped before this dialog (unsafe or already in place). */
  skipped?: number;
  onConfirm: (moves: OrganizeMoveInput[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => moves.map((m) => ({ ...m, checked: true })));
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.checked && r.destination.trim() !== '');

  return (
    <ModalDialog title="Organize with AI" onClose={onCancel}>
      {rows.length === 0 ? (
        <p>Nothing to move. Your files are already organized.</p>
      ) : (
        <>
          <p>Review the proposed moves. Clear a check box to skip a file, or edit a destination folder.</p>
          <table className="organize-table">
            <thead>
              <tr>
                <th aria-label="Move" />
                <th>File</th>
                <th>Move to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.fileId}>
                  <td>
                    <input type="checkbox" aria-label={`Move ${r.name}`} checked={r.checked} onChange={(e) => update(i, { checked: e.target.checked })} />
                  </td>
                  <td title={`${r.from}\\${r.name}`}>{r.name}</td>
                  <td>
                    <input type="text" aria-label={`Destination for ${r.name}`} value={r.destination} onChange={(e) => update(i, { destination: e.target.value })} />
                    {r.newFolder && r.destination === moves[i]?.destination && <span className="organize-new"> (new folder)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {skipped > 0 && <p>{skipped} suggestion(s) were ignored because they were unsafe or already in place.</p>}
      <div className="ui-modal-buttons">
        {rows.length > 0 && (
          <button type="button" autoFocus disabled={chosen.length === 0} onClick={() => onConfirm(chosen.map((r) => ({ fileId: r.fileId, destinationPath: r.destination.trim() })))}>
            Move {chosen.length} file(s)
          </button>
        )}
        <button type="button" onClick={onCancel}>
          {rows.length > 0 ? 'Cancel' : 'OK'}
        </button>
      </div>
    </ModalDialog>
  );
}
