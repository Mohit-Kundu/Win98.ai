import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, updateMetadata } from '../../src/actions';
import { aiClient } from '../../src/ai/client';
import { registerApp, unregisterApp } from '../../src/desktop/appRegistry';
import { Explorer } from '../../src/apps/explorer/Explorer';
import { useWindowStore } from '../../src/store/windows';

const props = { windowId: 'w1' };

async function mkFolder(path: string) {
  const r = await actions.createFolder({ path });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.node;
}

async function mkFile(path: string, text = 'hello') {
  const r = await actions.saveFile({ path, bytes: new TextEncoder().encode(text).buffer as ArrayBuffer, mime: 'text/plain' });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.fileId;
}

async function clearDesktop() {
  const r = await actions.listFolder({ path: 'C:\\Desktop' });
  if (r.ok) for (const n of r.value.items) await actions.deleteNode({ nodeId: n.id });
}

async function openDesktopFolder() {
  const r = await actions.listFolder({ path: 'C:\\Desktop' });
  if (!r.ok) throw new Error('no desktop');
  render(<Explorer {...props} launchArgs={{ folderId: r.value.folder.node.id }} />);
  await screen.findByText(/object\(s\)/);
}

beforeEach(async () => {
  useWindowStore.setState({ windows: {}, order: [], focusedId: null });
  await clearDesktop();
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  unregisterApp('wordpad');
});

describe('Explorer', () => {
  it('lists files with type labels and shows live updates from other apps', async () => {
    await mkFile('C:\\Desktop\\note.txt');
    await openDesktopFolder();
    expect(await screen.findByText('note.txt')).toBeTruthy();
    expect(screen.getByText('Text Document')).toBeTruthy();
    await mkFolder('C:\\Desktop\\Live');
    expect(await screen.findByText('Live')).toBeTruthy();
  });

  it('creates a folder through the New Folder dialog', async () => {
    await openDesktopFolder();
    fireEvent.click(screen.getByText('New Folder'));
    const dlg = await screen.findByRole('dialog', { name: 'New Folder' });
    fireEvent.change(within(dlg).getByLabelText('Folder name:'), { target: { value: 'Made' } });
    fireEvent.click(within(dlg).getByText('OK'));
    expect(await screen.findByRole('option', { name: /Made/ })).toBeTruthy();
  });

  it('renames via the context menu', async () => {
    await mkFile('C:\\Desktop\\old.txt');
    await openDesktopFolder();
    const row = await screen.findByRole('option', { name: /old\.txt/ });
    fireEvent.contextMenu(row);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Rename' }));
    const dlg = await screen.findByRole('dialog', { name: 'Rename' });
    fireEvent.change(within(dlg).getByLabelText('New name:'), { target: { value: 'new.txt' } });
    fireEvent.click(within(dlg).getByText('OK'));
    expect(await screen.findByRole('option', { name: /new\.txt/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /old\.txt/ })).toBeNull();
  });

  it('moves an item to another folder', async () => {
    await mkFile('C:\\Desktop\\mv.txt');
    await openDesktopFolder();
    fireEvent.contextMenu(await screen.findByRole('option', { name: /mv\.txt/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Move to...' }));
    const dlg = await screen.findByRole('dialog', { name: 'Move to' });
    fireEvent.change(within(dlg).getByLabelText('Destination folder path:'), { target: { value: 'C:\\My Documents' } });
    fireEvent.click(within(dlg).getByText('OK'));
    await waitFor(() => expect(screen.queryByRole('option', { name: /mv\.txt/ })).toBeNull());
    expect((await actions.listFolder({ path: 'C:\\My Documents' })).ok).toBe(true);
    expect((await actions.readMetadata({ path: 'C:\\My Documents\\mv.txt' })).ok).toBe(true);
    await actions.deleteNode({ path: 'C:\\My Documents\\mv.txt' });
  });

  it('asks for confirmation before deleting and keeps the file when declined', async () => {
    await mkFile('C:\\Desktop\\del.txt');
    await openDesktopFolder();
    fireEvent.contextMenu(await screen.findByRole('option', { name: /del\.txt/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
    const dlg = await screen.findByRole('dialog', { name: 'Confirm Delete' });
    fireEvent.click(within(dlg).getByText('No'));
    expect((await actions.readMetadata({ path: 'C:\\Desktop\\del.txt' })).ok).toBe(true);
    fireEvent.contextMenu(screen.getByRole('option', { name: /del\.txt/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Confirm Delete' })).getByText('Yes'));
    await waitFor(() => expect(screen.queryByRole('option', { name: /del\.txt/ })).toBeNull());
    expect((await actions.readMetadata({ path: 'C:\\Desktop\\del.txt' })).ok).toBe(false);
  });

  it('names the unsupported type when opening a file', async () => {
    await mkFile('C:\\Desktop\\data.xyz');
    await openDesktopFolder();
    fireEvent.doubleClick(await screen.findByRole('option', { name: /data\.xyz/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Explorer' });
    expect(dlg.textContent).toContain('.xyz');
  });

  it('opens a supported file via the registered app and navigates into folders', async () => {
    await mkFolder('C:\\Desktop\\Sub');
    await mkFile('C:\\Desktop\\doc.txt');
    registerApp({ id: 'wordpad', title: 'WordPad', icon: 'document', component: () => null, fileExtensions: ['txt'], singleInstance: false });
    await openDesktopFolder();
    fireEvent.doubleClick(await screen.findByRole('option', { name: /doc\.txt/ }));
    await waitFor(() => expect(Object.values(useWindowStore.getState().windows).some((w) => w.appId === 'wordpad')).toBe(true));
    fireEvent.doubleClick(screen.getByRole('option', { name: /Sub/ }));
    await waitFor(() => expect(screen.getByLabelText('Current folder').textContent).toBe('C:\\Desktop\\Sub'));
  });

  it('rejects unsupported and oversize uploads, accepts valid ones', async () => {
    await openDesktopFolder();
    const input = screen.getByLabelText('Upload file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'bad.exe')] } });
    expect((await screen.findByRole('dialog', { name: 'Explorer' })).textContent).toContain('.exe');
    fireEvent.click(screen.getByText('OK'));

    const big = new File(['x'], 'big.txt');
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect((await screen.findByRole('dialog', { name: 'Explorer' })).textContent).toContain('20 MB');
    fireEvent.click(screen.getByText('OK'));

    fireEvent.change(input, { target: { files: [new File(['hi'], 'up.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('option', { name: /up\.txt/ })).toBeTruthy();
  });

  it('shows an AI error indicator with Retry analysis, and records edited AI fields', async () => {
    const id = await mkFile('C:\\Desktop\\bad.txt', 'abc');
    await updateMetadata({ nodeId: id, patch: { aiStatus: 'error', aiError: 'boom', title: 'Old' } });
    await openDesktopFolder();
    const row = await screen.findByRole('option', { name: /bad\.txt/ });
    expect(within(row).getByRole('img', { name: 'AI analysis failed' }).getAttribute('title')).toContain('boom');
    fireEvent.contextMenu(row);
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Retry analysis' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Properties' }));
    const dlg = await screen.findByRole('dialog', { name: 'bad.txt Properties' });
    fireEvent.change(within(dlg).getByLabelText('AI title'), { target: { value: 'New' } });
    fireEvent.click(within(dlg).getByText('OK'));
    await waitFor(async () => {
      const m = await actions.readMetadata({ nodeId: id });
      expect(m.ok && m.value.meta.title).toBe('New');
      expect(m.ok && m.value.meta.aiEditedFields).toEqual(['title']);
    });
  });

  it('searches from the search bar, shows result details, filters by type, opens a hit, and clears', async () => {
    await mkFile('C:\\Desktop\\zeppelin.txt', 'the zeppelin flight manual');
    await mkFile('C:\\Desktop\\zeppelin-photo.png', 'zeppelin');
    registerApp({ id: 'wordpad', title: 'WordPad', icon: 'document', component: () => null, fileExtensions: ['txt'], singleInstance: false });
    await openDesktopFolder();
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'the file about zeppelin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const list = await screen.findByRole('list', { name: 'Search results' });
    const rows = await within(list).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const txtRow = rows.find((r) => r.textContent?.includes('zeppelin.txt'))!;
    expect(txtRow.textContent).toContain('C:\\Desktop');
    expect(txtRow.textContent).toContain('Text Document');
    expect(screen.getByText(/result\(s\)/).textContent).toContain('2 result(s)');

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /File type/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Search results' })).getAllByRole('listitem')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Open zeppelin.txt' }));
    await waitFor(() => expect(Object.values(useWindowStore.getState().windows).some((w) => w.appId === 'wordpad')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByRole('option', { name: /zeppelin\.txt/ })).toBeTruthy();
  });

  it('organizes with AI: decline moves nothing, confirm moves the checked files', async () => {
    const keep = await mkFile('C:\\Desktop\\keep.txt');
    const go = await mkFile('C:\\Desktop\\go.txt');
    vi.spyOn(aiClient, 'organize').mockResolvedValue({
      ok: true,
      value: {
        moves: [
          { fileId: keep, destination: 'C:\\My Documents' },
          { fileId: go, destination: 'c:\\my documents\\Sorted' },
        ],
      },
    });
    await openDesktopFolder();
    await screen.findByRole('option', { name: /go\.txt/ });

    fireEvent.click(screen.getByRole('button', { name: 'Organize with AI' }));
    let dlg = await screen.findByRole('dialog', { name: 'Organize with AI' });
    expect(within(dlg).getByLabelText('Destination for go.txt')).toBeTruthy();
    expect(dlg.textContent).toContain('(new folder)');
    fireEvent.click(within(dlg).getByText('Cancel'));
    expect((await actions.readMetadata({ path: 'C:\\Desktop\\go.txt' })).ok).toBe(true);
    expect((await actions.readMetadata({ path: 'C:\\Desktop\\keep.txt' })).ok).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Organize with AI' }));
    dlg = await screen.findByRole('dialog', { name: 'Organize with AI' });
    fireEvent.click(within(dlg).getByLabelText('Move keep.txt'));
    fireEvent.click(within(dlg).getByText('Move 1 file(s)'));
    await waitFor(() => expect(screen.queryByRole('option', { name: /go\.txt/ })).toBeNull());
    expect((await actions.readMetadata({ path: 'C:\\My Documents\\Sorted\\go.txt' })).ok).toBe(true);
    expect((await actions.readMetadata({ path: 'C:\\Desktop\\keep.txt' })).ok).toBe(true);
    expect((await screen.findByRole('dialog', { name: 'Explorer' })).textContent).toContain('Moved 1 of 1');
    await actions.deleteNode({ path: 'C:\\My Documents\\Sorted' });
  });

  it('shows an error when the AI is unavailable and moves nothing', async () => {
    await mkFile('C:\\Desktop\\solo.txt');
    vi.spyOn(aiClient, 'organize').mockResolvedValue({ ok: false, error: { code: 'AI_UNAVAILABLE', message: 'AI is down.' } });
    await openDesktopFolder();
    fireEvent.click(screen.getByRole('button', { name: 'Organize with AI' }));
    expect((await screen.findByRole('dialog', { name: 'Explorer' })).textContent).toContain('AI is down.');
    expect((await actions.readMetadata({ path: 'C:\\Desktop\\solo.txt' })).ok).toBe(true);
  });

  it('shows properties and persists edited notes', async () => {
    const id = await mkFile('C:\\Desktop\\props.txt', 'abc');
    await updateMetadata({ nodeId: id, patch: { title: 'My Title', tags: ['a', 'b'] } });
    await openDesktopFolder();
    fireEvent.contextMenu(await screen.findByRole('option', { name: /props\.txt/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Properties' }));
    const dlg = await screen.findByRole('dialog', { name: 'props.txt Properties' });
    expect((within(dlg).getByLabelText('AI title') as HTMLInputElement).value).toBe('My Title');
    expect((within(dlg).getByLabelText(/AI tags/) as HTMLInputElement).value).toBe('a, b');
    expect(dlg.textContent).toContain('C:\\Desktop');
    fireEvent.change(within(dlg).getByLabelText('Notes'), { target: { value: 'remember' } });
    fireEvent.click(within(dlg).getByText('OK'));
    await waitFor(async () => {
      const m = await actions.readMetadata({ nodeId: id });
      expect(m.ok && m.value.meta.notes).toBe('remember');
    });
  });
});
