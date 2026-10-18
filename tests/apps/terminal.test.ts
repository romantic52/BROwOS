import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualFileSystem } from '../../packages/filesystem/src/index';
import {
  absolutePath,
  parseCommand,
  runCommand,
  type TerminalContext,
} from '../../system-apps/terminal/src/commands';

describe('terminal lexer and paths', () => {
  it('preserves quoted names and empty arguments', () =>
    expect(parseCommand('write "My note.txt" ""')).toEqual(['write', 'My note.txt', '']));
  it('supports single quotes and escaped spaces', () =>
    expect(parseCommand("write My\\ note.txt 'hello world'")).toEqual([
      'write',
      'My note.txt',
      'hello world',
    ]));
  it('preserves Windows paths', () =>
    expect(parseCommand('cat C:\\Documents\\notes.txt')).toEqual([
      'cat',
      'C:\\Documents\\notes.txt',
    ]));
  it('does not evaluate shell substitution', () =>
    expect(parseCommand('echo "$(whoami)"')).toEqual(['echo', '$(whoami)']));
  it('rejects unterminated quotes', () => expect(() => parseCommand('cat "oops')).toThrow());
  it.each([
    ['../Pictures', '/Documents', '/Pictures'],
    ['C:\\Documents\\a.txt', '/Pictures', '/Documents/a.txt'],
    ['../../../../Documents', '/Music', '/Documents'],
    ['~/one.txt', '/', '/Documents/one.txt'],
    ['./child', '/Documents', '/Documents/child'],
  ])('resolves %s from %s', (path, cwd, expected) =>
    expect(absolutePath(path, cwd)).toBe(expected),
  );
});

describe('terminal commands use the real virtual filesystem', () => {
  let fs: VirtualFileSystem;
  let context: TerminalContext;
  beforeEach(async () => {
    fs = await VirtualFileSystem.create(`terminal-${crypto.randomUUID()}`);
    context = { fs, cwd: 'documents', openApp: vi.fn(), openFile: vi.fn() };
  });
  afterEach(() => fs.close());

  it('writes, appends and reads UTF-8 files with quoted names', async () => {
    await runCommand('write "Моя заметка.txt" "Первая\\nВторая"', context);
    await runCommand('append "Моя заметка.txt" "\\nТретья"', context);
    expect((await runCommand('cat "Моя заметка.txt"', context)).text).toBe(
      'Первая\nВторая\nТретья',
    );
    await runCommand('touch "Моя заметка.txt"', context);
    expect((await runCommand('cat "Моя заметка.txt"', context)).text).toContain('Третья');
  });
  it('creates, copies, moves and renames without overwriting source data', async () => {
    await runCommand('mkdir work', context);
    await runCommand('write note.txt hello', context);
    await runCommand('cp note.txt work', context);
    expect(fs.resolve('/Documents/note.txt')).toBeDefined();
    expect(fs.resolve('/Documents/work/note.txt')).toBeDefined();
    await runCommand('mv work /Desktop', context);
    await runCommand('rename /Desktop/work/note.txt renamed.txt', context);
    expect((await runCommand('cat /Desktop/work/renamed.txt', context)).text).toBe('hello');
  });
  it('moves a file to the recycle bin and restores its content', async () => {
    await runCommand('write note.txt valuable', context);
    const id = fs.resolve('/Documents/note.txt')!.id;
    await runCommand('rm note.txt', context);
    expect(fs.resolve('/Documents/note.txt')).toBeUndefined();
    expect((await runCommand('trash', context)).text).toContain(id);
    await runCommand(`restore ${id}`, context);
    expect((await runCommand('cat note.txt', context)).text).toBe('valuable');
  });
  it('resolves cwd and opens associated applications', async () => {
    expect((await runCommand('cd ../Pictures', context)).cwd).toBe('pictures');
    await runCommand('open /Pictures', context);
    expect(context.openApp).toHaveBeenCalledWith('explorer', { folderId: 'pictures' });
    await runCommand('open app:calculator', context);
    expect(context.openApp).toHaveBeenCalledWith('calculator');
  });
  it('rejects host shell commands and protects system folders', async () => {
    await expect(runCommand('npm install something', context)).rejects.toThrow(
      'Неизвестная команда',
    );
    await expect(runCommand('rm /Documents', context)).rejects.toThrow();
    await expect(runCommand('cp ../Pictures /Pictures', context)).rejects.toThrow();
  });
});
