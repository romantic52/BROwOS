import { useEffect, useState } from 'react';
import type { VirtualFileSystem } from '@browos/filesystem';
import { Icon } from '@browos/ui';
import { errorMessage } from '@browos/shared';

export interface FileDialogRequest {
  mode: 'open' | 'save';
  title?: string;
  accept?: string;
  name?: string;
  content?: Blob | string;
  mime?: string;
  parentId?: string;
  resolve: (id: string | null) => void;
}
export function FileDialog({
  request,
  fs,
  finish,
}: {
  request: FileDialogRequest;
  fs: VirtualFileSystem;
  finish: (id: string | null) => void;
}) {
  const [folder, setFolder] = useState(request.parentId || 'documents');
  const [name, setName] = useState(request.name || '');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function navigate(id: string) {
    setFolder(id);
    setSelected(null);
  }
  useEffect(() => {
    if (!fs.get(folder) || fs.get(folder)?.trashed) {
      setFolder('documents');
      setSelected(null);
    }
  }, [fs, folder, fs.revision]);
  const accepted = (mime: string, filename: string) =>
    !request.accept ||
    request.accept.split(',').some((v) => {
      v = v.trim();
      return v.startsWith('.')
        ? filename.toLowerCase().endsWith(v.toLowerCase())
        : v.endsWith('/*')
          ? mime.startsWith(v.slice(0, -1))
          : mime === v;
    });
  const entries = fs
    .list(folder)
    .filter((n) => n.kind === 'directory' || request.mode === 'save' || accepted(n.mime, n.name));
  async function confirm() {
    setError('');
    if (request.mode === 'open') {
      if (selected && fs.get(selected)?.parentId === folder && !fs.get(selected)?.trashed)
        finish(selected);
      return;
    }
    if (!name.trim()) {
      setError('Введите имя файла');
      return;
    }
    setBusy(true);
    try {
      const existing = fs
        .list(folder)
        .find((n) => n.name.toLowerCase() === name.trim().toLowerCase());
      if (existing) {
        if (existing.kind === 'directory') throw new Error('Это имя уже занято папкой');
        if (!window.confirm(`Заменить файл «${existing.name}»?`)) return;
        await fs.updateFile(existing.id, request.content ?? '', request.mime);
        finish(existing.id);
      } else {
        const node = await fs.writeFile(folder, name.trim(), request.content ?? '', request.mime);
        finish(node.id);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') finish(null);
      }}
    >
      <section
        className="file-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={request.title || (request.mode === 'save' ? 'Сохранить файл' : 'Открыть файл')}
      >
        <header>
          <Icon name={request.mode === 'save' ? 'file' : 'folder'} size={18} />
          <strong>
            {request.title || (request.mode === 'save' ? 'Сохранить файл' : 'Открыть файл')}
          </strong>
          <button aria-label="Закрыть диалог" onClick={() => finish(null)}>
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="file-dialog-path">
          <button
            title="Вверх"
            disabled={folder === 'root'}
            onClick={() => navigate(fs.get(folder)?.parentId || 'root')}
          >
            <Icon name="up" size={17} />
          </button>
          <span>{fs.get(folder) ? fs.path(folder) : '/'}</span>
        </div>
        <div className="file-dialog-main">
          <nav>
            {[
              ['root', 'Этот компьютер'],
              ['desktop', 'Рабочий стол'],
              ['documents', 'Документы'],
              ['downloads', 'Загрузки'],
              ['pictures', 'Изображения'],
              ['music', 'Музыка'],
              ['videos', 'Видео'],
            ].map(([id, title]) => (
              <button
                key={id}
                className={folder === id ? 'selected' : ''}
                onClick={() => navigate(id)}
              >
                <Icon name={id === 'root' ? 'computer' : 'folder'} size={16} />
                {title}
              </button>
            ))}
          </nav>
          <div className="file-dialog-list">
            {entries.length === 0 ? (
              <p>В этой папке пока нет файлов</p>
            ) : (
              entries.map((n) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={n.id}
                  className={`file-dialog-row ${selected === n.id ? 'selected' : ''}`}
                  onClick={() => {
                    if (n.kind === 'file') {
                      setSelected(n.id);
                      if (request.mode === 'save') setName(n.name);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (n.kind === 'directory') navigate(n.id);
                      else if (request.mode === 'open') finish(n.id);
                    }
                  }}
                  onDoubleClick={() =>
                    n.kind === 'directory'
                      ? navigate(n.id)
                      : request.mode === 'open'
                        ? finish(n.id)
                        : undefined
                  }
                >
                  <Icon
                    name={n.kind === 'directory' ? 'folder' : 'file'}
                    color={n.kind === 'directory' ? '#d69e1f' : '#608eaa'}
                  />
                  <span>{n.name}</span>
                  {n.kind === 'directory' && (
                    <button
                      type="button"
                      className="folder-enter"
                      aria-label={`Войти в ${n.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(n.id);
                      }}
                    >
                      <Icon name="forward" size={15} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        <footer>
          {request.mode === 'save' && (
            <label>
              Имя файла
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirm();
                }}
              />
            </label>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div>
            <button className="app-button" onClick={() => finish(null)}>
              Отмена
            </button>
            <button
              className="app-button primary"
              disabled={busy || (request.mode === 'open' && !selected)}
              onClick={() => void confirm()}
            >
              {busy ? 'Сохранение…' : request.mode === 'save' ? 'Сохранить' : 'Открыть'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
