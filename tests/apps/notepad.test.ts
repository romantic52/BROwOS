import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VirtualFileSystem } from '../../packages/filesystem/src/index';
import { readTextDocument, saveTextDocument } from '../../system-apps/notepad/src/document';

describe('Notepad document revision protection', () => {
  let fs: VirtualFileSystem;
  beforeEach(async () => {
    fs = await VirtualFileSystem.create(`notepad-${crypto.randomUUID()}`);
  });
  afterEach(() => fs.close());

  it('loads the UTF-8 content and saves against its loaded version', async () => {
    const file = await fs.writeFile('documents', 'note.txt', 'Привет');
    const loaded = await readTextDocument(fs, file.id);
    expect(loaded.content).toBe('Привет');
    const saved = await saveTextDocument(fs, file.id, 'Привет, BROwOS!', loaded.updatedAt);
    expect(saved.updatedAt).toBeGreaterThan(loaded.updatedAt);
    expect(await fs.readText(file.id)).toBe('Привет, BROwOS!');
  });
  it('retains the newer file when another editor has saved since the read', async () => {
    const file = await fs.writeFile('documents', 'note.txt', 'original');
    const loaded = await readTextDocument(fs, file.id);
    await fs.updateFile(file.id, 'newer edit');
    await expect(
      saveTextDocument(fs, file.id, 'stale edit', loaded.updatedAt),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await fs.readText(file.id)).toBe('newer edit');
  });
  it('will not overwrite a file that failed to load', async () => {
    const file = await fs.writeFile('documents', 'note.txt', 'valuable content');
    await expect(saveTextDocument(fs, file.id, '', undefined)).rejects.toThrow('не был загружен');
    expect(await fs.readText(file.id)).toBe('valuable content');
  });
});
