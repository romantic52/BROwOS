import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VirtualFileSystem } from '../../packages/filesystem/src/index';
import { appForFile } from '../../packages/application-runtime/src/index';
import { normalizeWebUrl } from '../../packages/shared/src/index';
import { evaluateExpression, formatResult } from '../../system-apps/calculator/src/calculate';
import { readTextDocument, saveTextDocument } from '../../system-apps/notepad/src/document';
import { runCommand, type TerminalContext } from '../../system-apps/terminal/src/commands';

const connections: VirtualFileSystem[] = [];
const databases = new Set<string>();
async function open(name = `browos-app-integration-${crypto.randomUUID()}`) {
  databases.add(name);
  const fs = await VirtualFileSystem.create(name);
  connections.push(fs);
  return fs;
}
function terminal(fs: VirtualFileSystem): TerminalContext {
  return { fs, cwd: 'documents', openFile: vi.fn(), openApp: vi.fn() };
}
afterEach(async () => {
  for (const fs of connections.splice(0)) fs.close();
  await Promise.all(
    [...databases].map(
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

describe('applications share one durable filesystem', () => {
  it('persists a terminal-created calculation, saves its result as an editor document, and reopens it after reload', async () => {
    const name = `calculation-workflow-${crypto.randomUUID()}`;
    const fs = await open(name);
    const context = terminal(fs);
    await runCommand('mkdir "Project budget"', context);
    await runCommand('write "Project budget/calculation.txt" "1250 × (1 + 20%)"', context);
    const expression = (await runCommand('cat "Project budget/calculation.txt"', context)).text;
    const calculated = formatResult(evaluateExpression(expression));
    expect(calculated).toBe('1500');
    await runCommand(`write "Project budget/result.txt" "Total: ${calculated}"`, context);
    const result = fs.resolve('/Documents/Project budget/result.txt')!;
    const document = await readTextDocument(fs, result.id);
    await saveTextDocument(
      fs,
      result.id,
      `${document.content}\nChecked and saved.`,
      document.updatedAt,
      document.mime,
    );
    expect(appForFile(result.name, result.mime)).toBe('notepad');
    fs.close();

    const reopened = await open(name);
    const restoredContext = terminal(reopened);
    expect((await runCommand('cat "Project budget/result.txt"', restoredContext)).text).toBe(
      'Total: 1500\nChecked and saved.',
    );
    await runCommand('open "Project budget/result.txt"', restoredContext);
    expect(restoredContext.openFile).toHaveBeenCalledWith(result.id);
  });

  it('protects an unsaved editor buffer when a terminal updates the same document', async () => {
    const fs = await open();
    const context = terminal(fs);
    await runCommand('write shared.txt "Original"', context);
    const file = fs.resolve('/Documents/shared.txt')!;
    const editor = await readTextDocument(fs, file.id);
    await runCommand('append shared.txt "\\nFrom terminal"', context);
    await expect(
      saveTextDocument(
        fs,
        file.id,
        `${editor.content}\nUnsaved editor text`,
        editor.updatedAt,
        editor.mime,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await runCommand('cat shared.txt', context)).text).toBe('Original\nFrom terminal');
    const latest = await readTextDocument(fs, file.id);
    await saveTextDocument(
      fs,
      file.id,
      `${latest.content}\nMerged editor text`,
      latest.updatedAt,
      latest.mime,
    );
    expect((await runCommand('cat shared.txt', context)).text).toBe(
      'Original\nFrom terminal\nMerged editor text',
    );
  });

  it('reports one conflict for simultaneous terminal appends instead of claiming two successful saves', async () => {
    const name = `append-conflict-${crypto.randomUUID()}`;
    const first = await open(name);
    const file = await first.writeFile('documents', 'shared.txt', 'Base');
    const second = await open(name);
    const operations = await Promise.allSettled([
      runCommand('append shared.txt " + first"', terminal(first)),
      runCommand('append shared.txt " + second"', terminal(second)),
    ]);
    expect(operations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = operations.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('CONFLICT');
    const contents = await first.readText(file.id);
    expect(['Base + first', 'Base + second']).toContain(contents);
    await runCommand(
      `append shared.txt " + ${contents.endsWith('first') ? 'second' : 'first'}"`,
      terminal(first),
    );
    expect(await first.readText(file.id)).toContain('+ first');
    expect(await second.readText(file.id)).toContain('+ second');
  });

  it('treats file contents as data across terminal, calculator and browser-address boundaries', async () => {
    const fs = await open();
    const context = terminal(fs);
    await runCommand('write input.txt "globalThis.alert(1)"', context);
    const input = (await runCommand('cat input.txt', context)).text;
    const revision = fs.revision;
    expect(() => evaluateExpression(input)).toThrow();
    expect(fs.revision).toBe(revision);
    await runCommand('write address.txt "javascript:alert(1)"', context);
    const unsafeAddress = (await runCommand('cat address.txt', context)).text;
    expect(() => normalizeWebUrl(unsafeAddress)).toThrow();
    expect(unsafeAddress).toBe('javascript:alert(1)');
    await runCommand('write address.txt "localhost:3000/project"', context);
    const address = (await runCommand('cat address.txt', context)).text;
    expect(normalizeWebUrl(address)).toBe('http://localhost:3000/project');
  });
});
