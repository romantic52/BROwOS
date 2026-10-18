import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FSError, VirtualFileSystem } from '../../packages/filesystem/src/index';

const connections: VirtualFileSystem[] = [];
const databases = new Set<string>();

async function open(name = `browos-test-${crypto.randomUUID()}`): Promise<VirtualFileSystem> {
  databases.add(name);
  const filesystem = await VirtualFileSystem.create(name);
  connections.push(filesystem);
  return filesystem;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const connection of connections.splice(0)) connection.close();
  await Promise.all(
    Array.from(databases).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    ),
  );
  databases.clear();
});

describe('persistent virtual filesystem', () => {
  it('seeds protected system folders and readable useful sample files once', async () => {
    const name = `seed-${crypto.randomUUID()}`;
    const filesystem = await open(name);
    expect(filesystem.list('root').map((node) => node.name)).toEqual([
      'Desktop',
      'Documents',
      'Downloads',
      'Music',
      'Pictures',
      'Videos',
    ]);
    expect(await filesystem.readText('welcome')).toContain('real file');
    expect(await filesystem.readText('sample-landscape')).toContain('<svg');
    expect(filesystem.get('sample-landscape')?.mime).toBe('image/svg+xml');
    const count = filesystem.getUsage().files;
    filesystem.close();
    const reopened = await open(name);
    expect(reopened.getUsage().files).toBe(count);
    expect(reopened.rootId).toBe('root');
  });

  it('persists UTF-8 contents and updated metadata after closing and reopening', async () => {
    const name = `persist-${crypto.randomUUID()}`;
    const filesystem = await open(name);
    const file = await filesystem.writeFile('documents', 'Привет.txt', 'Привет, мир!');
    expect(file.size).toBe(new Blob(['Привет, мир!']).size);
    const updated = await filesystem.updateFile(file.id, 'Saved across reloads ✓');
    expect(updated.createdAt).toBe(file.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(file.updatedAt);
    filesystem.close();
    const reopened = await open(name);
    expect(await reopened.readText(file.id)).toBe('Saved across reloads ✓');
    expect(reopened.resolve('/Documents/Привет.txt')?.id).toBe(file.id);
  });

  it('uses case-insensitive names, normalized paths, and immutable metadata snapshots', async () => {
    const filesystem = await open();
    const folder = await filesystem.mkdir('documents', 'Projects');
    const file = await filesystem.writeFile(folder.id, 'Notes.txt', 'ideas');
    expect(filesystem.path(file.id)).toBe('/Documents/Projects/Notes.txt');
    expect(filesystem.resolve('C:\\documents\\PROJECTS\\notes.txt')?.id).toBe(file.id);
    expect(filesystem.resolve('/Documents/./Projects/../Projects/Notes.txt')?.id).toBe(file.id);
    expect(filesystem.resolve('/../../Documents')?.id).toBe('documents');
    expect(filesystem.resolve('/Documents/Projects/Notes.txt/missing')).toBeUndefined();
    const snapshot = filesystem.get(file.id);
    if (snapshot) snapshot.name = 'cannot mutate internal state';
    expect(filesystem.get(file.id)?.name).toBe('Notes.txt');
    expect(filesystem.search('NOTE').map((node) => node.id)).toContain(file.id);
  });

  it('rejects invalid names and name collisions without overwriting data', async () => {
    const filesystem = await open();
    for (const name of [
      '',
      ' ',
      '..',
      '.',
      'bad/name',
      'bad\\name',
      'bad\u0000name',
      'bad.',
      'bad ',
      'NUL.txt',
      'COM1',
      'a'.repeat(256),
    ]) {
      await expect(filesystem.writeFile('documents', name, 'bad')).rejects.toMatchObject({
        code: 'INVALID_NAME',
      });
    }
    const file = await filesystem.writeFile('documents', 'Report.txt', 'original');
    await expect(
      filesystem.writeFile('documents', 'REPORT.TXT', 'replacement'),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    await expect(filesystem.mkdir('documents', 'report.txt')).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    expect(await filesystem.readText(file.id)).toBe('original');
    const normalized = await filesystem.writeFile('documents', 'cafe\u0301.txt', 'unicode');
    expect(normalized.name).toBe('café.txt');
    await expect(filesystem.writeFile('documents', 'café.txt', 'collision')).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
  });

  it('moves and renames entire directory trees without changing IDs or contents', async () => {
    const filesystem = await open();
    const folder = await filesystem.mkdir('documents', 'Project');
    const child = await filesystem.mkdir(folder.id, 'Source');
    const file = await filesystem.writeFile(child.id, 'readme.txt', 'stable');
    await filesystem.rename(folder.id, 'Renamed');
    await filesystem.move(folder.id, 'desktop');
    expect(filesystem.path(file.id)).toBe('/Desktop/Renamed/Source/readme.txt');
    expect(await filesystem.readText(file.id)).toBe('stable');
    expect(filesystem.list('documents').some((node) => node.id === folder.id)).toBe(false);
    await filesystem.mkdir('desktop', 'Other');
    await expect(filesystem.rename(folder.id, 'OTHER')).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    expect(filesystem.get(folder.id)?.name).toBe('Renamed');
  });

  it('protects system directories, validates destinations, and blocks folder cycles', async () => {
    const filesystem = await open();
    for (const id of ['root', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos']) {
      await expect(filesystem.trash(id)).rejects.toMatchObject({ code: 'PROTECTED' });
      await expect(filesystem.deletePermanent(id)).rejects.toMatchObject({ code: 'PROTECTED' });
      await expect(filesystem.rename(id, 'Changed')).rejects.toMatchObject({ code: 'PROTECTED' });
      await expect(filesystem.move(id, 'documents')).rejects.toMatchObject({ code: 'PROTECTED' });
    }
    const parent = await filesystem.mkdir('documents', 'Parent');
    const child = await filesystem.mkdir(parent.id, 'Child');
    const file = await filesystem.writeFile(child.id, 'data.txt', 'safe');
    await expect(filesystem.move(parent.id, child.id)).rejects.toMatchObject({
      code: 'INVALID_MOVE',
    });
    await expect(filesystem.copy(parent.id, child.id)).rejects.toMatchObject({
      code: 'INVALID_MOVE',
    });
    await expect(filesystem.move(child.id, child.id)).rejects.toMatchObject({
      code: 'INVALID_MOVE',
    });
    await expect(filesystem.mkdir(file.id, 'Invalid')).rejects.toMatchObject({
      code: 'NOT_DIRECTORY',
    });
    await expect(filesystem.readFile(parent.id)).rejects.toMatchObject({ code: 'NOT_FILE' });
    await expect(filesystem.updateFile(parent.id, 'invalid')).rejects.toMatchObject({
      code: 'NOT_FILE',
    });
    await expect(filesystem.move(file.id, 'does-not-exist')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(filesystem.path(file.id)).toBe('/Documents/Parent/Child/data.txt');
  });

  it('copies directory trees with independent IDs, safe duplicate names, and independent file updates', async () => {
    const filesystem = await open();
    const folder = await filesystem.mkdir('documents', 'Project');
    const child = await filesystem.mkdir(folder.id, 'Source');
    const original = await filesystem.writeFile(child.id, 'code.txt', 'version one');
    const copy = await filesystem.copy(folder.id, 'documents');
    expect(copy.name).toBe('Project - Copy');
    expect(copy.id).not.toBe(folder.id);
    const copiedFile = filesystem.resolve('/Documents/Project - Copy/Source/code.txt');
    expect(copiedFile?.id).not.toBe(original.id);
    expect(await filesystem.readText(copiedFile!.id)).toBe('version one');
    await filesystem.updateFile(copiedFile!.id, 'version two');
    expect(await filesystem.readText(original.id)).toBe('version one');
    expect((await filesystem.copy(folder.id, 'documents')).name).toBe('Project - Copy (2)');
    const copyOfFile = await filesystem.copy(original.id, child.id);
    expect(copyOfFile.name).toBe('code - Copy.txt');
  });

  it('keeps generated copy names within the filename limit', async () => {
    const filesystem = await open();
    const file = await filesystem.writeFile('documents', `a.${'b'.repeat(253)}`, 'long name');
    const copy = await filesystem.copy(file.id, 'documents');
    expect(copy.name.length).toBeLessThanOrEqual(255);
    expect(copy.name).not.toBe(file.name);
    expect(await filesystem.readText(copy.id)).toBe('long name');
  });

  it('recursively trashes, restores, and permanently deletes while preserving trash storage accounting', async () => {
    const filesystem = await open();
    const folder = await filesystem.mkdir('documents', 'Folder');
    const child = await filesystem.mkdir(folder.id, 'Nested');
    const file = await filesystem.writeFile(child.id, 'story.txt', 'Keep me');
    const before = filesystem.getUsage();
    await filesystem.trash(folder.id);
    expect(filesystem.resolve('/Documents/Folder')).toBeUndefined();
    expect(filesystem.search('story')).toEqual([]);
    expect(filesystem.listTrash().map((node) => node.id)).toEqual([folder.id]);
    expect(filesystem.get(file.id)?.trashed).toBe(true);
    expect(filesystem.getUsage()).toEqual(before);
    await expect(filesystem.writeFile(folder.id, 'bad.txt', 'bad')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(filesystem.updateFile(file.id, 'bad')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await filesystem.restore(folder.id);
    expect(filesystem.resolve('/Documents/Folder/Nested/story.txt')?.id).toBe(file.id);
    expect(await filesystem.readText(file.id)).toBe('Keep me');
    expect(filesystem.listTrash()).toEqual([]);
    await filesystem.trash(folder.id);
    await filesystem.deletePermanent(folder.id);
    expect(filesystem.get(folder.id)).toBeUndefined();
    expect(filesystem.get(child.id)).toBeUndefined();
    expect(filesystem.get(file.id)).toBeUndefined();
    expect(filesystem.getUsage().bytes).toBe(before.bytes - file.size);
  });

  it('does not restore independently deleted children when their parent is restored', async () => {
    const filesystem = await open();
    const folder = await filesystem.mkdir('documents', 'Folder');
    const old = await filesystem.writeFile(folder.id, 'data.txt', 'old version');
    await filesystem.trash(old.id);
    const current = await filesystem.writeFile(folder.id, 'data.txt', 'current version');
    await filesystem.trash(folder.id);
    await filesystem.restore(folder.id);
    expect(filesystem.list(folder.id).map((node) => node.id)).toEqual([current.id]);
    expect(filesystem.listTrash().map((node) => node.id)).toEqual([old.id]);
    expect(filesystem.get(old.id)?.trashed).toBe(true);
    await expect(filesystem.restore(old.id)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(await filesystem.readText(current.id)).toBe('current version');
  });

  it('rejects restoration name conflicts and can recover a child of a deleted folder to Documents', async () => {
    const filesystem = await open();
    const folder = await filesystem.mkdir('desktop', 'Deleted');
    const file = await filesystem.writeFile(folder.id, 'recover.txt', 'recovered');
    await filesystem.trash(folder.id);
    await filesystem.mkdir('desktop', 'Deleted');
    await expect(filesystem.restore(folder.id)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(filesystem.get(folder.id)?.trashed).toBe(true);
    await filesystem.restore(file.id);
    expect(filesystem.path(file.id)).toBe('/Documents/recover.txt');
    expect(await filesystem.readText(file.id)).toBe('recovered');
    expect(filesystem.get(folder.id)?.trashed).toBe(true);
  });

  it('merges validated backups without replacing existing files and round-trips binary contents', async () => {
    const source = await open();
    const folder = await source.mkdir('downloads', 'Archive');
    const bytes = new Uint8Array([0, 255, 1, 127, 200, 0, 42]);
    await source.writeFile(folder.id, 'payload.bin', new Blob([bytes]), 'application/octet-stream');
    await source.writeFile(folder.id, 'notes.txt', 'Привет ✓');
    const backup = await source.exportBackup();
    const target = await open();
    const existing = await target.mkdir('downloads', 'Archive');
    const kept = await target.writeFile(existing.id, 'notes.txt', 'existing content');
    await target.importBackup(backup);
    expect(await target.readText(kept.id)).toBe('existing content');
    const imported = target.resolve('/Downloads/Archive - Imported/payload.bin');
    expect(imported).toBeDefined();
    expect(new Uint8Array(await (await target.readFile(imported!.id)).arrayBuffer())).toEqual(
      bytes,
    );
    expect(
      await target.readText(target.resolve('/Downloads/Archive - Imported/notes.txt')!.id),
    ).toBe('Привет ✓');
    await target.importBackup(backup);
    expect(target.resolve('/Downloads/Archive - Imported (2)/payload.bin')).toBeDefined();
  });

  it('preserves independent recycle-bin groups through backup export and import', async () => {
    const source = await open();
    const folder = await source.mkdir('downloads', 'Saved folder');
    const old = await source.writeFile(folder.id, 'item.txt', 'old');
    await source.trash(old.id);
    await source.writeFile(folder.id, 'item.txt', 'new');
    await source.trash(folder.id);
    const target = await open();
    await target.importBackup(await source.exportBackup());
    const imported = target.listTrash().find((node) => node.name === 'Saved folder');
    await target.restore(imported!.id);
    const live = target.resolve('/Downloads/Saved folder/item.txt');
    expect(await target.readText(live!.id)).toBe('new');
    expect(target.listTrash().filter((node) => node.name === 'item.txt')).toHaveLength(1);
  });

  it('validates the complete backup before mutation, rejecting malformed data, cycles, and broken parents', async () => {
    const filesystem = await open();
    const parent = await filesystem.mkdir('documents', 'Parent');
    const child = await filesystem.mkdir(parent.id, 'Child');
    const file = await filesystem.writeFile(child.id, 'payload.txt', 'payload');
    const valid = await filesystem.exportBackup();
    const usage = filesystem.getUsage();
    const revision = filesystem.revision;
    const corrupt = (edit: (nodes: Array<Record<string, unknown>>) => void): string => {
      const backup = JSON.parse(valid) as { nodes: Array<Record<string, unknown>> };
      edit(backup.nodes);
      return JSON.stringify(backup);
    };
    const cases = [
      '{broken json',
      '{}',
      corrupt((nodes) => {
        nodes.push({ ...nodes[0] });
      }),
      corrupt((nodes) => {
        nodes.find((node) => node.id === parent.id)!.parentId = child.id;
      }),
      corrupt((nodes) => {
        nodes.find((node) => node.id === file.id)!.parentId = 'missing';
      }),
      corrupt((nodes) => {
        nodes.find((node) => node.id === file.id)!.contentsBase64 = '<invalid>';
      }),
      corrupt((nodes) => {
        nodes.find((node) => node.id === file.id)!.size = 999_999;
      }),
      corrupt((nodes) => {
        nodes.find((node) => node.id === file.id)!.name = '../escape.txt';
      }),
      corrupt((nodes) => {
        nodes.find((node) => node.id === 'documents')!.name = 'Hijacked';
      }),
      corrupt((nodes) => {
        nodes.find((node) => node.id === parent.id)!.trashed = true;
      }),
    ];
    for (const backup of cases) {
      await expect(filesystem.importBackup(backup)).rejects.toBeInstanceOf(FSError);
      expect(filesystem.getUsage()).toEqual(usage);
      expect(filesystem.revision).toBe(revision);
    }
    expect(await filesystem.readText(file.id)).toBe('payload');
  });

  it('serializes independent connections and revalidates collisions against the latest committed state', async () => {
    const name = `concurrent-${crypto.randomUUID()}`;
    const first = await open(name);
    const second = await open(name);
    const files = await Promise.all([
      first.writeFile('documents', 'first.txt', 'first'),
      second.writeFile('documents', 'second.txt', 'second'),
    ]);
    await Promise.all([first.refresh(), second.refresh()]);
    for (const filesystem of [first, second]) {
      for (const file of files) expect(filesystem.get(file.id)).toBeDefined();
    }
    const results = await Promise.allSettled([
      first.writeFile('documents', 'same.txt', 'one'),
      second.writeFile('documents', 'SAME.TXT', 'two'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('ALREADY_EXISTS');
    await second.refresh();
    expect(
      second.list('documents').filter((node) => node.name.toLowerCase() === 'same.txt'),
    ).toHaveLength(1);
  });

  it('rolls back multi-record writes on quota failure and reports an actionable error', async () => {
    const filesystem = await open();
    const usage = filesystem.getUsage();
    const revision = filesystem.revision;
    const originalPut = IDBObjectStore.prototype.put;
    let calls = 0;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      calls += 1;
      if (calls === 2) throw new DOMException('Mock storage full', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    });
    await expect(
      filesystem.writeFile('documents', 'quota.txt', 'not partially saved'),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    spy.mockRestore();
    await filesystem.refresh();
    expect(filesystem.getUsage()).toEqual(usage);
    expect(filesystem.revision).toBe(revision);
    expect(filesystem.resolve('/Documents/quota.txt')).toBeUndefined();
    await filesystem.writeFile('documents', 'after-error.txt', 'queue recovers');
    expect(filesystem.resolve('/Documents/after-error.txt')).toBeDefined();
  });

  it('detects stale editor saves when an expected file timestamp is supplied', async () => {
    const name = `editor-conflict-${crypto.randomUUID()}`;
    const first = await open(name);
    const second = await open(name);
    const file = await first.writeFile('documents', 'shared.txt', 'original');
    const newer = await second.updateFile(file.id, 'another tab saved', undefined, file.updatedAt);
    await expect(
      first.updateFile(file.id, 'stale editor contents', undefined, file.updatedAt),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await first.readText(file.id)).toBe('another tab saved');
    const saved = await first.updateFile(file.id, 'merged changes', undefined, newer.updatedAt);
    expect(saved.updatedAt).toBeGreaterThan(newer.updatedAt);
    expect(await second.readText(file.id)).toBe('merged changes');
  });

  it('notifies subscribers after commit, isolates subscriber errors, and rejects writes after close', async () => {
    const filesystem = await open();
    const listener = vi.fn(() => {
      expect(filesystem.resolve('/Documents/observable.txt')).toBeDefined();
    });
    const unsubscribe = filesystem.subscribe(listener);
    const broken = filesystem.subscribe(() => {
      throw new Error('UI subscriber failed');
    });
    await filesystem.writeFile('documents', 'observable.txt', 'committed');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    broken();
    await filesystem.writeFile('documents', 'another.txt', 'okay');
    expect(listener).toHaveBeenCalledTimes(1);
    filesystem.close();
    await expect(filesystem.writeFile('documents', 'closed.txt', 'bad')).rejects.toMatchObject({
      code: 'CLOSED',
    });
  });
});
