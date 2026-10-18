import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppProps } from '@browos/sdk';
import { readTextDocument, saveTextDocument } from './document';
import './apps.css';

export function NotepadApp({ services, windowId, data }: AppProps) {
  const [fileId, setFileId] = useState<string | undefined>(
    typeof data?.fileId === 'string' ? data.fileId : undefined,
  );
  const [text, setText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [wrap, setWrap] = useState(true);
  const [fontSize, setFontSize] = useState(14);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [find, setFind] = useState('');
  const [showFind, setShowFind] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const initialFileId = useRef(fileId);
  const savedVersion = useRef<number | undefined>(undefined);
  const savedRef = useRef(savedText);
  const textRef = useRef(text);
  savedRef.current = savedText;
  textRef.current = text;
  const dirty = text !== savedText;
  const name = (fileId && services.fs.get(fileId)?.name) || 'Без имени.txt';

  const confirmDiscard = useCallback(
    () =>
      textRef.current === savedRef.current ||
      window.confirm('В документе есть несохранённые изменения. Закрыть без сохранения?'),
    [],
  );

  useEffect(() => {
    services.setCloseGuard(windowId, dirty ? confirmDiscard : null);
    return () => services.setCloseGuard(windowId, null);
  }, [services.setCloseGuard, windowId, confirmDiscard, dirty]);
  useEffect(
    () => services.setTitle(windowId, `${dirty ? '● ' : ''}${name} — Блокнот`),
    [dirty, name, services.setTitle, windowId],
  );

  useEffect(() => {
    const id = initialFileId.current;
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    readTextDocument(services.fs, id)
      .then(({ content, updatedAt }) => {
        if (cancelled) return;
        savedVersion.current = updatedAt;
        setText(content);
        setSavedText(content);
        setError('');
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Не удалось открыть файл');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [services.fs]);

  async function open() {
    if (!confirmDiscard()) return;
    const id = await services.pickFile({
      title: 'Открыть текстовый файл',
      accept: 'text/*,application/json,.md,.log,.csv,.js,.ts,.css,.html,.xml',
    });
    if (!id) return;
    setLoading(true);
    try {
      const { content, updatedAt } = await readTextDocument(services.fs, id);
      savedVersion.current = updatedAt;
      setFileId(id);
      setText(content);
      setSavedText(content);
      setCursor({ line: 1, column: 1 });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть файл');
    } finally {
      setLoading(false);
    }
  }
  async function save(asNew = false) {
    if (saving || loading) return;
    const content = text;
    setSaving(true);
    try {
      const mime = services.fs.get(fileId || '')?.mime || 'text/plain';
      let id: string | null;
      if (!asNew && fileId) {
        const saved = await saveTextDocument(
          services.fs,
          fileId,
          content,
          savedVersion.current,
          mime,
        );
        savedVersion.current = saved.updatedAt;
        id = saved.id;
      } else {
        id = await services.saveFile({ name, content, mime });
        if (id) savedVersion.current = services.fs.get(id)?.updatedAt;
      }
      if (id) {
        setFileId(id);
        setSavedText(content);
        setError('');
        services.notify('Документ сохранён', 'success');
      }
    } catch (cause) {
      setError(
        cause && typeof cause === 'object' && 'code' in cause && cause.code === 'CONFLICT'
          ? 'Файл изменён в другом окне или вкладке. Ваш текст сохранён в редакторе. Используйте «Сохранить как» для отдельной копии или откройте файл повторно.'
          : cause instanceof Error
            ? cause.message
            : 'Не удалось сохранить файл',
      );
    } finally {
      setSaving(false);
    }
  }
  function createNew() {
    if (!confirmDiscard()) return;
    setFileId(undefined);
    savedVersion.current = undefined;
    setText('');
    setSavedText('');
    setError('');
    setCursor({ line: 1, column: 1 });
    editor.current?.focus();
  }
  function updateCursor() {
    const target = editor.current;
    if (!target) return;
    const before = target.value.slice(0, target.selectionStart);
    const lines = before.split('\n');
    setCursor({ line: lines.length, column: (lines.at(-1)?.length || 0) + 1 });
  }
  function findNext() {
    const target = editor.current;
    if (!target || !find) return;
    const normalized = text.toLocaleLowerCase();
    let index = normalized.indexOf(find.toLocaleLowerCase(), target.selectionEnd);
    if (index < 0) index = normalized.indexOf(find.toLocaleLowerCase());
    if (index < 0) {
      services.notify('Текст не найден');
      return;
    }
    target.focus();
    target.setSelectionRange(index, index + find.length);
    const line = text.slice(0, index).split('\n').length;
    target.scrollTop = Math.max(0, (line - 3) * fontSize * 1.6);
    updateCursor();
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      void save(event.shiftKey);
    }
    if (key === 'o') {
      event.preventDefault();
      void open();
    }
    if (key === 'f') {
      event.preventDefault();
      setShowFind((value) => !value);
    }
  }

  return (
    <section className="browos-notepad" aria-label="Блокнот" onKeyDown={keyDown}>
      <div className="app-toolbar browos-notepad-toolbar">
        <button
          className="app-button"
          type="button"
          onClick={createNew}
          disabled={loading || saving}
        >
          Создать
        </button>
        <button
          className="app-button"
          type="button"
          onClick={() => void open()}
          disabled={loading || saving}
        >
          Открыть
        </button>
        <button
          className="app-button"
          type="button"
          onClick={() => void save()}
          disabled={loading || saving}
          title="Ctrl+S"
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button
          className="app-button"
          type="button"
          onClick={() => void save(true)}
          disabled={loading || saving}
        >
          Сохранить как
        </button>
        <button
          className="app-button"
          type="button"
          onClick={() => setShowFind((value) => !value)}
          aria-pressed={showFind}
        >
          Найти
        </button>
        <label className="browos-notepad-wrap">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />
          Перенос
        </label>
        <label className="browos-notepad-size">
          Шрифт{' '}
          <select
            aria-label="Размер шрифта"
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
          >
            {[12, 14, 16, 18, 22, 28].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      {showFind && (
        <form
          className="browos-notepad-find"
          onSubmit={(event) => {
            event.preventDefault();
            findNext();
          }}
        >
          <input
            className="field-input"
            aria-label="Найти в документе"
            placeholder="Найти в документе"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            autoFocus
          />
          <button type="submit" className="app-button">
            Найти далее
          </button>
          <button
            type="button"
            className="app-button"
            onClick={() => setShowFind(false)}
            aria-label="Закрыть поиск"
          >
            ×
          </button>
        </form>
      )}
      {error && (
        <div className="browos-notepad-error" role="alert">
          {error}
        </div>
      )}
      <textarea
        ref={editor}
        className="browos-notepad-editor"
        aria-label="Текст документа"
        spellCheck={false}
        value={text}
        readOnly={loading}
        wrap={wrap ? 'soft' : 'off'}
        style={{ fontSize }}
        onChange={(event) => setText(event.target.value)}
        onSelect={updateCursor}
        onKeyUp={updateCursor}
        placeholder={loading ? 'Загрузка файла…' : 'Начните писать…'}
      />
      <footer className="app-statusbar browos-notepad-status">
        <span>
          {loading ? 'Загрузка…' : dirty ? 'Есть изменения' : 'Сохранено'} ·{' '}
          {text.length.toLocaleString('ru-RU')} символов
        </span>
        <span>
          Стр {cursor.line}, стлб {cursor.column}
        </span>
        <span>UTF-8</span>
      </footer>
    </section>
  );
}
