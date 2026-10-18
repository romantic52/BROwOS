import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import type { FSNode } from '@browos/filesystem';
import type { AppProps } from '@browos/sdk';
import { AppIcon, Icon } from '@browos/ui';
import { errorMessage, formatBytes } from '@browos/shared';
import './style.css';

let clipboard: { ids: string[]; mode: 'copy' | 'cut' } | null = null;
let clipboardRevision = 0;
const clipboardListeners = new Set<() => void>();
function publishClipboard(value: typeof clipboard) {
  clipboard = value;
  clipboardRevision++;
  clipboardListeners.forEach((fn) => fn());
}
function subscribeClipboard(fn: () => void) {
  clipboardListeners.add(fn);
  return () => {
    clipboardListeners.delete(fn);
  };
}
const places = [
  ['desktop', 'Рабочий стол', 'desktop'],
  ['documents', 'Документы', 'file'],
  ['downloads', 'Загрузки', 'download'],
  ['pictures', 'Изображения', 'photos'],
  ['music', 'Музыка', 'music'],
  ['videos', 'Видео', 'media'],
] as const;
const labels: Record<string, string> = {
  root: 'Этот компьютер',
  desktop: 'Рабочий стол',
  documents: 'Документы',
  downloads: 'Загрузки',
  pictures: 'Изображения',
  music: 'Музыка',
  videos: 'Видео',
  trash: 'Корзина',
};
function fileIcon(node: FSNode) {
  if (node.kind === 'directory') return 'folder';
  if (node.mime.startsWith('image/')) return 'photos';
  if (node.mime.startsWith('audio/')) return 'music';
  if (node.mime.startsWith('video/')) return 'media';
  return 'file';
}

export function ExplorerApp({ services, windowId, data }: AppProps) {
  const { fs, revision, notify } = services;
  const first =
    typeof data?.folderId === 'string' &&
    (data.folderId === 'trash' || fs.get(data.folderId)?.kind === 'directory')
      ? data.folderId
      : 'root';
  const [history, setHistory] = useState([first]);
  const [position, setPosition] = useState(0);
  const folder = history[position];
  const trash = folder === 'trash';
  const [address, setAddress] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<'name' | 'updatedAt' | 'size'>('name');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    type: 'folder' | 'file' | 'rename';
    value: string;
    id?: string;
  } | null>(null);
  const [properties, setProperties] = useState<FSNode | null>(null);
  const [context, setContext] = useState<{ x: number; y: number; id?: string } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useSyncExternalStore(
    subscribeClipboard,
    () => clipboardRevision,
    () => 0,
  );
  useEffect(() => {
    services.setTitle(
      windowId,
      `${labels[folder] || fs.get(folder)?.name || 'Проводник'} — Проводник`,
    );
    setAddress(trash ? 'Корзина' : fs.path(folder));
    setSelected([]);
    setQuery('');
  }, [folder, fs, services.setTitle, windowId, trash]);
  useEffect(() => {
    if (!trash && !fs.get(folder)) {
      setHistory(['root']);
      setPosition(0);
    }
  }, [revision, folder, fs, trash]);
  function navigate(id: string) {
    setHistory((prev) => [...prev.slice(0, position + 1), id]);
    setPosition(position + 1);
    setContext(null);
  }
  function choose(node: FSNode) {
    if (trash) {
      setSelected([node.id]);
      return;
    }
    if (node.kind === 'directory') navigate(node.id);
    else services.openFile(node.id);
  }
  function select(event: MouseEvent, node: FSNode) {
    event.stopPropagation();
    setSelected((prev) =>
      event.ctrlKey || event.metaKey
        ? prev.includes(node.id)
          ? prev.filter((id) => id !== node.id)
          : [...prev, node.id]
        : [node.id],
    );
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setContext(null);
    try {
      await action();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  function copy(mode: 'copy' | 'cut') {
    if (!selected.length || trash) return;
    publishClipboard({ ids: [...selected], mode });
    notify(
      `${selected.length === 1 ? 'Элемент' : 'Элементы'} ${mode === 'copy' ? 'скопирован в буфер' : 'готов к перемещению'}`,
    );
    setContext(null);
  }
  async function paste() {
    if (!clipboard || trash) return;
    const saved = clipboard;
    await run(async () => {
      for (const id of saved.ids)
        if (fs.get(id)) {
          if (saved.mode === 'copy') await fs.copy(id, folder);
          else await fs.move(id, folder);
        }
      if (saved.mode === 'cut') publishClipboard(null);
      notify('Готово', 'success');
    });
  }
  async function remove() {
    if (!selected.length) return;
    const ids = [...selected];
    if (
      trash &&
      !window.confirm(
        `Удалить окончательно ${ids.length} элемент(ов)? Восстановить их будет нельзя.`,
      )
    )
      return;
    await run(async () => {
      for (const id of ids)
        if (trash) await fs.deletePermanent(id);
        else await fs.trash(id);
      setSelected([]);
      notify(trash ? 'Файлы удалены окончательно' : 'Перемещено в корзину', 'success');
    });
  }
  async function restore() {
    const ids = [...selected];
    await run(async () => {
      for (const id of ids) await fs.restore(id);
      setSelected([]);
      notify('Восстановлено', 'success');
    });
  }
  async function download() {
    await run(async () => {
      for (const id of selected) {
        const node = fs.get(id);
        if (node?.kind !== 'file') continue;
        const blob = await fs.readFile(id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = node.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
  async function importFiles(files: FileList | null) {
    if (!files || trash) return;
    await run(async () => {
      let count = 0;
      for (const file of Array.from(files)) {
        let name = file.name;
        let n = 1;
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        while (fs.list(folder).some((node) => node.name.toLowerCase() === name.toLowerCase()))
          name = `${base} (${n++})${ext}`;
        await fs.writeFile(folder, name, file, file.type);
        count++;
      }
      notify(`Импортировано файлов: ${count}`, 'success');
    });
  }
  async function saveEditor() {
    if (!editor) return;
    await run(async () => {
      if (editor.type === 'folder') await fs.mkdir(folder, editor.value);
      if (editor.type === 'file') {
        const file = await fs.writeFile(folder, editor.value, '', 'text/plain');
        setSelected([file.id]);
      }
      if (editor.type === 'rename' && editor.id) await fs.rename(editor.id, editor.value);
      setEditor(null);
    });
  }
  function contextMenu(event: MouseEvent, id?: string) {
    event.preventDefault();
    event.stopPropagation();
    if (id && !selected.includes(id)) setSelected([id]);
    const rect = rootRef.current?.getBoundingClientRect();
    setContext({
      x: Math.min(event.clientX - (rect?.left || 0), Math.max(0, (rect?.width || 600) - 210)),
      y: Math.min(event.clientY - (rect?.top || 0), Math.max(0, (rect?.height || 400) - 250)),
      id,
    });
  }
  async function drop(event: DragEvent, target = folder) {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    if (trash) return;
    if (event.dataTransfer.files.length) {
      await importFiles(event.dataTransfer.files);
      return;
    }
    const raw = event.dataTransfer.getData('application/x-browos-files');
    try {
      const ids: unknown = JSON.parse(raw);
      if (Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
        await run(async () => {
          for (const id of ids) await fs.move(id, target);
          notify('Файлы перемещены', 'success');
        });
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  }
  const nodes = (trash ? fs.listTrash() : query ? fs.search(query) : fs.list(folder))
    .slice()
    .sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === 'directory'
          ? -1
          : 1
        : sort === 'name'
          ? a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' })
          : sort === 'size'
            ? b.size - a.size
            : b.updatedAt - a.updatedAt,
    );
  const selection = selected.length === 1 ? fs.get(selected[0]) : undefined;
  const breadcrumbs: FSNode[] = [];
  let cursor = fs.get(folder);
  while (cursor && cursor.id !== 'root') {
    breadcrumbs.unshift(cursor);
    cursor = cursor.parentId ? fs.get(cursor.parentId) : undefined;
  }
  const usage = fs.getUsage();
  const toolbarButton = (title: string, icon: string, action: () => void, disabled = false) => (
    <button title={title} aria-label={title} disabled={disabled || busy} onClick={action}>
      <Icon name={icon} size={20} />
      <span>{title}</span>
    </button>
  );
  return (
    <div
      ref={rootRef}
      className={`explorer-app ${dropActive ? 'drop-active' : ''}`}
      tabIndex={-1}
      onContextMenu={(event) => contextMenu(event)}
      onClick={() => setContext(null)}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).matches('input,textarea')) return;
        if (event.key === 'Delete') {
          event.preventDefault();
          void remove();
        }
        if (event.key === 'F2' && selection) {
          event.preventDefault();
          setEditor({ type: 'rename', value: selection.name, id: selection.id });
        }
        if (event.ctrlKey || event.metaKey) {
          if (event.key.toLowerCase() === 'c') {
            event.preventDefault();
            copy('copy');
          }
          if (event.key.toLowerCase() === 'x') {
            event.preventDefault();
            copy('cut');
          }
          if (event.key.toLowerCase() === 'v') {
            event.preventDefault();
            void paste();
          }
          if (event.key.toLowerCase() === 'a') {
            event.preventDefault();
            setSelected(nodes.map((n) => n.id));
          }
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!trash) setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false);
      }}
      onDrop={(e) => void drop(e)}
    >
      <div className="explorer-menu">
        <button className="file-menu" onClick={() => importRef.current?.click()}>
          Файл
        </button>
        <span className="active">Главная</span>
        <button onClick={() => void download()} disabled={!selected.length}>
          Поделиться
        </button>
        <button onClick={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))}>Вид</button>
        <div />
        <Icon name="info" size={16} />
      </div>
      <div className="explorer-ribbon">
        {trash ? (
          <>
            {toolbarButton('Восстановить', 'restore', () => void restore(), !selected.length)}
            {toolbarButton('Удалить навсегда', 'trash', () => void remove(), !selected.length)}
          </>
        ) : (
          <>
            {toolbarButton('Новая папка', 'folder', () =>
              setEditor({ type: 'folder', value: 'Новая папка' }),
            )}
            {toolbarButton('Новый файл', 'file', () =>
              setEditor({ type: 'file', value: 'Новый документ.txt' }),
            )}
            <i />
            {toolbarButton('Копировать', 'copy', () => copy('copy'), !selected.length)}
            {toolbarButton('Вырезать', 'cut', () => copy('cut'), !selected.length)}
            {toolbarButton('Вставить', 'paste', () => void paste(), !clipboard)}
            <i />
            {toolbarButton(
              'Переименовать',
              'rename',
              () =>
                selection && setEditor({ type: 'rename', value: selection.name, id: selection.id }),
              !selection,
            )}
            {toolbarButton('Удалить', 'trash', () => void remove(), !selected.length)}
            <i />
            {toolbarButton('Импорт', 'upload', () => importRef.current?.click())}
            {toolbarButton(
              'Скачать',
              'download',
              () => void download(),
              !selected.some((id) => fs.get(id)?.kind === 'file'),
            )}
          </>
        )}
      </div>
      <div className="explorer-address">
        <button
          aria-label="Назад"
          disabled={position === 0}
          onClick={() => setPosition(position - 1)}
        >
          <Icon name="back" size={16} />
        </button>
        <button
          aria-label="Вперёд"
          disabled={position >= history.length - 1}
          onClick={() => setPosition(position + 1)}
        >
          <Icon name="forward" size={16} />
        </button>
        <button
          aria-label="На уровень вверх"
          disabled={folder === 'root' || trash}
          onClick={() => navigate(fs.get(folder)?.parentId || 'root')}
        >
          <Icon name="up" size={17} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const node = fs.resolve(address);
            if (node?.kind === 'directory') navigate(node.id);
            else notify('Папка не найдена', 'error');
          }}
        >
          <Icon name={trash ? 'trash' : 'folder'} size={16} />
          <input
            aria-label="Путь к папке"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button
            title="Обновить"
            aria-label="Обновить папку"
            type="button"
            onClick={() => setAddress(trash ? 'Корзина' : fs.path(folder))}
          >
            <Icon name="refresh" size={15} />
          </button>
        </form>
        <label>
          <Icon name="search" size={15} />
          <input
            aria-label="Поиск файлов"
            placeholder="Поиск файлов"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected([]);
            }}
          />
        </label>
      </div>
      <div className="explorer-body">
        <nav className="explorer-sidebar">
          <div className="sidebar-heading">
            <Icon name="star" size={15} />
            Быстрый доступ
          </div>
          {places.map(([id, label, icon]) => (
            <button
              key={id}
              className={folder === id ? 'selected' : ''}
              onClick={() => navigate(id)}
            >
              <Icon
                name={icon}
                size={17}
                color={id === 'downloads' ? '#279b63' : id === 'pictures' ? '#9684b8' : '#618fba'}
              />
              {label}
            </button>
          ))}
          <div className="sidebar-divider" />
          <button className={folder === 'root' ? 'selected' : ''} onClick={() => navigate('root')}>
            <Icon name="computer" size={18} color="#318abc" />
            Этот компьютер
          </button>
          <button className={trash ? 'selected' : ''} onClick={() => navigate('trash')}>
            <Icon name="trash" size={17} />
            Корзина{fs.listTrash().length > 0 && <small>{fs.listTrash().length}</small>}
          </button>
          <div className="explorer-storage">
            <Icon name="lock" size={16} />
            <span>
              Локальное хранилище
              <small>
                {formatBytes(usage.bytes)} · {usage.files} файлов
              </small>
            </span>
          </div>
        </nav>
        <section
          className="explorer-files"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected([]);
          }}
        >
          <div className="explorer-section-heading">
            <h2>
              {query ? `Результаты поиска «${query}»` : labels[folder] || fs.get(folder)?.name}
            </h2>
            <select
              aria-label="Сортировка файлов"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="name">По имени</option>
              <option value="updatedAt">По дате</option>
              <option value="size">По размеру</option>
            </select>
            <button
              title={view === 'grid' ? 'Список' : 'Крупные значки'}
              aria-label="Переключить вид"
              onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            >
              <Icon name={view === 'grid' ? 'list' : 'grid'} size={17} />
            </button>
          </div>
          {folder === 'root' && !query && (
            <div className="explorer-local-card">
              <Icon name="computer" size={35} />
              <div>
                <strong>Локальный диск (C:)</strong>
                <span>Ваши файлы в BROwOS · IndexedDB</span>
                <small>{formatBytes(usage.bytes)} данных на этом устройстве</small>
              </div>
              <span className="local-badge">LOCAL</span>
            </div>
          )}
          {view === 'list' && (
            <div className="file-list-head">
              <span>Имя</span>
              <span>Изменён</span>
              <span>Размер</span>
            </div>
          )}
          <div className={`file-items file-items-${view}`} aria-label="Файлы и папки">
            {nodes.map((node) => (
              <button
                key={node.id}
                data-file-id={node.id}
                data-testid="file-item"
                className={`file-item ${selected.includes(node.id) ? 'selected' : ''} ${clipboard?.mode === 'cut' && clipboard.ids.includes(node.id) ? 'cut-item' : ''}`}
                draggable={!trash && !places.some((p) => p[0] === node.id)}
                onClick={(event) => select(event, node)}
                onDoubleClick={() => choose(node)}
                onContextMenu={(event) => contextMenu(event, node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') choose(node);
                }}
                onDragStart={(event) => {
                  const ids = selected.includes(node.id) ? selected : [node.id];
                  event.dataTransfer.setData('application/x-browos-files', JSON.stringify(ids));
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  if (node.kind === 'directory') {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onDrop={(event) => {
                  if (node.kind === 'directory') void drop(event, node.id);
                }}
              >
                <AppIcon
                  name={fileIcon(node)}
                  color={
                    node.kind === 'directory'
                      ? '#e6b340'
                      : node.mime.startsWith('image/')
                        ? '#8b77bf'
                        : '#5aa4cb'
                  }
                  size={view === 'grid' ? 46 : 23}
                />
                <span className="file-name">{labels[node.id] || node.name}</span>
                {view === 'list' ? (
                  <>
                    <time>{new Date(node.updatedAt).toLocaleDateString('ru-RU')}</time>
                    <span className="file-size">
                      {node.kind === 'file' ? formatBytes(node.size) : 'Папка'}
                    </span>
                  </>
                ) : (
                  <small>
                    {node.kind === 'directory'
                      ? `${fs.list(node.id).length} элементов`
                      : formatBytes(node.size)}
                  </small>
                )}
              </button>
            ))}
          </div>
          {!nodes.length && (
            <div className="explorer-empty">
              <Icon name={trash ? 'trash' : query ? 'search' : 'folder'} size={58} />
              <h3>{trash ? 'Корзина пуста' : query ? 'Ничего не найдено' : 'Здесь пока пусто'}</h3>
              <p>
                {trash
                  ? 'Удалённые файлы появятся здесь.'
                  : query
                    ? 'Попробуйте другое имя файла.'
                    : 'Перетащите файлы сюда или создайте новую папку.'}
              </p>
              {!trash && !query && (
                <button className="app-button" onClick={() => importRef.current?.click()}>
                  Добавить файлы
                </button>
              )}
            </div>
          )}
        </section>
      </div>
      <div className="explorer-status">
        <span>
          {nodes.length} элементов{selected.length ? ` · Выбрано: ${selected.length}` : ''}
        </span>
        <div />
        {busy ? (
          <span>Выполняется…</span>
        ) : (
          <span>
            <span className="status-dot" />
            Все изменения сохранены
          </span>
        )}
      </div>
      <input
        ref={importRef}
        type="file"
        multiple
        hidden
        aria-label="Импортировать файлы"
        onChange={(e) => {
          void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {dropActive && (
        <div className="explorer-drop-overlay">
          <Icon name="upload" size={46} />
          <strong>Добавить в {labels[folder] || fs.get(folder)?.name}</strong>
        </div>
      )}
      {context && (
        <div className="explorer-context" style={{ left: context.x, top: context.y }}>
          {context.id && (
            <>
              <button
                onClick={() => {
                  const n = fs.get(context.id!);
                  if (n) choose(n);
                  setContext(null);
                }}
                disabled={trash}
              >
                Открыть
              </button>
              {!trash && (
                <>
                  <button onClick={() => copy('copy')}>Копировать</button>
                  <button onClick={() => copy('cut')}>Вырезать</button>
                  <button
                    onClick={() => {
                      const n = fs.get(context.id!);
                      if (n) setEditor({ type: 'rename', value: n.name, id: n.id });
                      setContext(null);
                    }}
                  >
                    Переименовать
                  </button>
                </>
              )}
              {trash && <button onClick={() => void restore()}>Восстановить</button>}
              <button onClick={() => void remove()}>
                {trash ? 'Удалить навсегда' : 'В корзину'}
              </button>
              <button
                onClick={() => {
                  setProperties(fs.get(context.id!) || null);
                  setContext(null);
                }}
              >
                Свойства
              </button>
              <hr />
            </>
          )}
          {!trash && (
            <>
              <button disabled={!clipboard} onClick={() => void paste()}>
                Вставить
              </button>
              <button
                onClick={() => {
                  setEditor({ type: 'folder', value: 'Новая папка' });
                  setContext(null);
                }}
              >
                Новая папка
              </button>
              <button
                onClick={() => {
                  setEditor({ type: 'file', value: 'Новый документ.txt' });
                  setContext(null);
                }}
              >
                Текстовый документ
              </button>
            </>
          )}
        </div>
      )}
      {editor && (
        <div className="explorer-modal">
          <form
            role="dialog"
            aria-label={editor.type === 'rename' ? 'Переименовать' : 'Создать элемент'}
            className="text-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEditor();
            }}
          >
            <Icon name={editor.type === 'folder' ? 'folder' : 'file'} size={34} />
            <h3>
              {editor.type === 'folder'
                ? 'Новая папка'
                : editor.type === 'file'
                  ? 'Новый текстовый файл'
                  : 'Переименовать'}
            </h3>
            <label>
              Имя
              <input
                autoFocus
                aria-label="Имя элемента"
                className="field-input"
                value={editor.value}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setEditor({ ...editor, value: e.target.value })}
              />
            </label>
            <div>
              <button type="button" className="app-button" onClick={() => setEditor(null)}>
                Отмена
              </button>
              <button
                type="submit"
                className="app-button primary"
                disabled={busy || !editor.value.trim()}
              >
                {editor.type === 'rename' ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </form>
        </div>
      )}
      {properties && (
        <div className="explorer-modal">
          <section className="text-dialog" role="dialog" aria-label="Свойства файла">
            <h3>{properties.name}</h3>
            <dl>
              <dt>Тип</dt>
              <dd>{properties.kind === 'directory' ? 'Папка' : properties.mime || 'Файл'}</dd>
              <dt>Расположение</dt>
              <dd>{fs.path(properties.id)}</dd>
              <dt>Размер</dt>
              <dd>{formatBytes(properties.size)}</dd>
              <dt>Создан</dt>
              <dd>{new Date(properties.createdAt).toLocaleString('ru-RU')}</dd>
              <dt>Изменён</dt>
              <dd>{new Date(properties.updatedAt).toLocaleString('ru-RU')}</dd>
            </dl>
            <button className="app-button primary" onClick={() => setProperties(null)}>
              Закрыть
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
