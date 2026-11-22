import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actions, syncAppShortcuts } from '../../src/actions';
import { Explorer } from '../../src/apps/explorer/Explorer';
import { RecycleBin } from '../../src/apps/recycleBin/RecycleBin';
import { registerApp, unregisterApp } from '../../src/desktop/appRegistry';
import { Desktop } from '../../src/desktop/Desktop';
import { useWindowStore } from '../../src/store/windows';

const REFUSAL = 'System Applications cannot be deleted';

function Hello() {
  return <p>hello body</p>;
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

beforeEach(async () => {
  useWindowStore.setState({ windows: {}, order: [], focusedId: null });
  registerApp({ id: 'test-hello', title: 'Hello', icon: 'document', component: Hello, fileExtensions: [], singleInstance: false });
  await actions.emptyRecycleBin();
  await clearDesktop();
  await actions.emptyRecycleBin();
});

afterEach(() => {
  cleanup();
  unregisterApp('test-hello');
  localStorage.clear();
});

describe('desktop icons', () => {
  it('Delete key on an application icon shows the refusal', async () => {
    render(<Desktop />);
    const icon = screen.getByText('Hello', { selector: '.desktop-icon span' }).closest('button')!;
    fireEvent.keyDown(icon, { key: 'Delete' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(REFUSAL);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('the right-click menu offers Open and Delete, and Delete shows the refusal', async () => {
    render(<Desktop />);
    const icon = screen.getByText('Hello', { selector: '.desktop-icon span' }).closest('button')!;
    fireEvent.contextMenu(icon);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Delete']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    expect((await screen.findByRole('alert')).textContent).toBe(REFUSAL);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(Object.keys(useWindowStore.getState().windows)).toHaveLength(0);
  });

  it('Open from the menu launches the application', async () => {
    render(<Desktop />);
    fireEvent.contextMenu(screen.getByText('Hello', { selector: '.desktop-icon span' }).closest('button')!);
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Open' }));
    expect(Object.keys(useWindowStore.getState().windows)).toHaveLength(1);
  });
});

describe('Explorer and application shortcuts', () => {
  it('lists Program Files shortcuts, refuses to delete one, and hides the Recycle Bin folder', async () => {
    await syncAppShortcuts();
    const root = await actions.listFolder({ path: 'C:\\' });
    if (!root.ok) throw new Error('no root');
    const pf = await actions.listFolder({ path: 'C:\\Program Files' });
    if (!pf.ok) throw new Error('no program files');
    expect(pf.value.items.length).toBeGreaterThan(0);

    render(<Explorer windowId="w1" launchArgs={{ folderId: root.value.folder.node.id }} />);
    expect(await screen.findByText('Program Files', { selector: '.explorer-name' })).toBeTruthy();
    expect(screen.queryByText('Recycle Bin')).toBeNull();

    fireEvent.doubleClick(screen.getByText('Program Files', { selector: '.explorer-name' }));
    const shortcut = pf.value.items[0]!;
    const row = await screen.findByText(shortcut.name, { selector: '.explorer-name' });
    fireEvent.mouseDown(row);
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Files' }), { key: 'Delete' });
    const confirm = await screen.findByRole('dialog', { name: 'Confirm Delete' });
    fireEvent.click(within(confirm).getByText('Yes'));
    const msg = await screen.findByRole('dialog', { name: 'Explorer' });
    expect(msg.textContent).toContain(REFUSAL);
  });
});

describe('Recycle Bin window', () => {
  it('lists deleted items and restores one with a message saying where it went', async () => {
    const id = await mkFile('C:\\Desktop\\gone.txt');
    await actions.deleteNode({ nodeId: id });
    render(<RecycleBin />);
    const row = await screen.findByText('gone.txt', { selector: '.bin-cell' });
    expect(screen.getByText('C:\\Desktop', { selector: '.bin-cell' })).toBeTruthy();
    fireEvent.mouseDown(row);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const msg = await screen.findByRole('alert');
    expect(msg.textContent).toContain('restored to C:\\Desktop\\gone.txt');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect((await actions.readMetadata({ path: 'C:\\Desktop\\gone.txt' })).ok).toBe(true);
    await waitFor(() => expect(screen.getByText('The Recycle Bin is empty.')).toBeTruthy());
  });

  it('says so when the item went to the Desktop or was renamed', async () => {
    const id = await mkFile('C:\\Desktop\\dup.txt');
    await actions.deleteNode({ nodeId: id });
    await mkFile('C:\\Desktop\\dup.txt', 'new');
    render(<RecycleBin />);
    fireEvent.mouseDown(await screen.findByText('dup.txt', { selector: '.bin-cell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect((await screen.findByRole('alert')).textContent).toContain('dup (restored).txt');
  });

  it('Delete Permanently asks first and then removes the item for good', async () => {
    const id = await mkFile('C:\\Desktop\\bye.txt');
    await actions.deleteNode({ nodeId: id });
    render(<RecycleBin />);
    fireEvent.mouseDown(await screen.findByText('bye.txt', { selector: '.bin-cell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    const dlg = await screen.findByRole('dialog', { name: 'Confirm Delete' });
    expect(dlg.textContent).toContain('cannot be undone');
    fireEvent.click(within(dlg).getByText('Yes'));
    await waitFor(() => expect(screen.getByText('The Recycle Bin is empty.')).toBeTruthy());
    const listed = await actions.listRecycleBin();
    expect(listed.ok && listed.value).toEqual([]);
  });

  it('Empty Recycle Bin is disabled when empty and clears everything after confirmation', async () => {
    render(<RecycleBin />);
    const empty = await screen.findByRole('button', { name: 'Empty Recycle Bin' });
    expect((empty as HTMLButtonElement).disabled).toBe(true);
    await actions.deleteNode({ nodeId: await mkFile('C:\\Desktop\\one.txt') });
    await actions.deleteNode({ nodeId: await mkFile('C:\\Desktop\\two.txt') });
    await screen.findByText('one.txt', { selector: '.bin-cell' });
    expect((empty as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(empty);
    const dlg = await screen.findByRole('dialog', { name: 'Empty Recycle Bin' });
    fireEvent.click(within(dlg).getByText('Yes'));
    await waitFor(() => expect(screen.getByText('The Recycle Bin is empty.')).toBeTruthy());
  });

  it('Cancel keeps the item', async () => {
    await actions.deleteNode({ nodeId: await mkFile('C:\\Desktop\\stay.txt') });
    render(<RecycleBin />);
    fireEvent.mouseDown(await screen.findByText('stay.txt', { selector: '.bin-cell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Confirm Delete' })).getByText('No'));
    const listed = await actions.listRecycleBin();
    expect(listed.ok && listed.value.map((e) => e.originalName)).toEqual(['stay.txt']);
  });
});
