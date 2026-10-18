import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppProps } from '@browos/sdk';
import { runCommand } from './commands';
import './apps.css';

type Entry = { id: number; prompt?: string; command?: string; text: string; error?: boolean };

export function TerminalApp({ services, windowId, data }: AppProps) {
  const [cwd, setCwd] = useState(typeof data?.folderId === 'string' ? data.folderId : 'documents');
  const [entries, setEntries] = useState<Entry[]>([
    {
      id: 0,
      text: 'BROwOS Terminal 0.1\nВиртуальная файловая система · UTF-8\nВведите help для списка команд. Здесь нет командной оболочки ОС-хоста.\n',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const historyCursor = useRef(0);
  const historyDraft = useRef('');
  const sequence = useRef(0);
  const output = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = services.fs.get(cwd);
  const activeCwd = current?.kind === 'directory' && !current.trashed ? cwd : 'documents';
  const path = services.fs.path(activeCwd);
  const prompt = `guest@BROwOS:${path}$`;

  useEffect(
    () => services.setTitle(windowId, `Терминал — ${path}`),
    [path, windowId, services.setTitle],
  );
  useEffect(() => {
    output.current?.scrollTo({ top: output.current.scrollHeight });
  }, [entries, busy]);
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  async function submit() {
    const command = input.trim();
    if (!command || busy) return;
    setInput('');
    setBusy(true);
    if (history.current.at(-1) !== command)
      history.current = [...history.current, command].slice(-100);
    historyCursor.current = history.current.length;
    historyDraft.current = '';
    const id = ++sequence.current;
    setEntries((items) => [...items, { id, prompt, command, text: '' }].slice(-300));
    try {
      const result = await runCommand(command, {
        fs: services.fs,
        cwd: activeCwd,
        openApp: services.openApp,
        openFile: services.openFile,
      });
      if (result.cwd) setCwd(result.cwd);
      if (result.clear) setEntries([]);
      else
        setEntries((items) =>
          items.map((entry) => (entry.id === id ? { ...entry, text: result.text } : entry)),
        );
    } catch (cause) {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                text: cause instanceof Error ? cause.message : 'Ошибка команды',
                error: true,
              }
            : entry,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyCursor.current === history.current.length) historyDraft.current = input;
      historyCursor.current = Math.min(
        history.current.length,
        Math.max(0, historyCursor.current + (event.key === 'ArrowUp' ? -1 : 1)),
      );
      setInput(
        historyCursor.current === history.current.length
          ? historyDraft.current
          : history.current[historyCursor.current] || '',
      );
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setEntries([]);
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
      event.preventDefault();
      setInput('');
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const match = input.match(/^(.*\s|)([^\s"']*)$/);
      if (!match) return;
      const prefix = match[2] || '';
      if (prefix.includes('/') || prefix.includes('\\')) return;
      const matches = services.fs
        .list(activeCwd)
        .filter((node) => node.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()));
      if (matches.length === 1) {
        const name = matches[0]!.name;
        setInput(`${match[1]}${/\s/.test(name) ? `"${name}"` : name}`);
      }
    }
  }

  return (
    <section className="browos-terminal" aria-label="Терминал BROwOS">
      <div className="browos-terminal-bar">
        <span className="browos-terminal-dot" />
        Виртуальная консоль<span className="browos-terminal-bar-note">LOCAL / IndexedDB</span>
        <button
          type="button"
          onClick={() => {
            setEntries([]);
            inputRef.current?.focus();
          }}
          title="Ctrl+L"
        >
          Очистить
        </button>
      </div>
      <div
        className="browos-terminal-scroll"
        ref={output}
        onClick={(event) => {
          if (event.target === event.currentTarget && !window.getSelection()?.toString())
            inputRef.current?.focus();
        }}
      >
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          className="browos-terminal-output"
        >
          {entries.map((entry) => (
            <div className="browos-terminal-entry" key={entry.id}>
              {entry.command && (
                <div className="browos-terminal-command">
                  <span>{entry.prompt}</span> {entry.command}
                </div>
              )}
              {entry.text && (
                <pre className={entry.error ? 'browos-terminal-error' : ''}>{entry.text}</pre>
              )}
            </div>
          ))}
        </div>
        <form
          className="browos-terminal-input-row"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={`terminal-${windowId}`}>{prompt}</label>
          <input
            id={`terminal-${windowId}`}
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={keyboard}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            aria-label="Команда терминала"
          />
        </form>
        {busy && (
          <div className="browos-terminal-working" role="status">
            Выполнение…
          </div>
        )}
      </div>
      <footer className="browos-terminal-footer">
        Tab — дополнить имя · ↑ ↓ — история · Ctrl+L — очистить
      </footer>
    </section>
  );
}
