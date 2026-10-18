import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { VirtualFileSystem } from '@browos/filesystem';
import { applications, appForFile, findApp } from '@browos/application-runtime';
import { defaultSettings, loadSettings, storeSettings } from '@browos/kernel';
import type { SystemNotification } from '@browos/kernel';
import {
  clampBounds,
  initialWindowState,
  restoreWindowSession,
  windowReducer,
} from '@browos/window-manager';
import { AppIcon, Icon } from '@browos/ui';
import { errorMessage, VERSION } from '@browos/shared';
import type { AppProps, DesktopServices } from '@browos/sdk';
import { WindowFrame } from './WindowFrame';
import { FileDialog } from './FileDialog';
import type { FileDialogRequest } from './FileDialog';
import { ExplorerApp } from '../../../system-apps/explorer/src/index';
import { BrowserApp } from '../../../system-apps/browser/src/index';
import { SettingsApp } from '../../../system-apps/settings/src/index';
import { TaskManagerApp } from '../../../system-apps/task-manager/src/index';
import { NotepadApp } from '@browos/notepad';
import { CalculatorApp } from '@browos/calculator';
import { PaintApp } from '@browos/paint';
import { TerminalApp } from '@browos/terminal';
import { PhotosApp } from '@browos/photos';
import { MediaPlayerApp } from '@browos/media-player';

const components: Record<string, (props: AppProps) => ReactNode> = {
  explorer: ExplorerApp,
  browser: BrowserApp,
  notepad: NotepadApp,
  calculator: CalculatorApp,
  paint: PaintApp,
  terminal: TerminalApp,
  photos: PhotosApp,
  'media-player': MediaPlayerApp,
};
const knownApps = new Set(applications.map((a) => a.id));
class AppBoundary extends Component<{ children: ReactNode; name: string }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="app-empty">
        <Icon name="info" size={40} />
        <h2>Не удалось открыть {this.props.name}</h2>
        <p>{this.state.error}</p>
        <button className="app-button" onClick={() => this.setState({ error: '' })}>
          Попробовать снова
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function OperatingSystem() {
  const [fs, setFs] = useState<VirtualFileSystem | null>(null);
  const [error, setError] = useState('');
  const [boot, setBoot] = useState(true);
  useEffect(() => {
    let active = true;
    let database: VirtualFileSystem | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    VirtualFileSystem.create()
      .then((value) => {
        database = value;
        if (active) {
          setFs(value);
          timer = setTimeout(() => setBoot(false), 650);
        } else value.close();
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      database?.close();
    };
  }, []);
  if (error)
    return (
      <div className="boot-screen">
        <Icon name="logo" size={74} />
        <h1>BROwOS</h1>
        <h2>Не удалось открыть хранилище</h2>
        <p>{error}</p>
        <p>Разрешите хранение данных для этого сайта и перезагрузите страницу.</p>
        <button className="app-button" onClick={() => location.reload()}>
          Повторить
        </button>
      </div>
    );
  if (boot || !fs)
    return (
      <div className="boot-screen">
        <Icon name="logo" size={76} />
        <h1>BROwOS</h1>
        <div className="boot-spinner" />
        <p>Готовим ваше рабочее пространство</p>
      </div>
    );
  return <Desktop fs={fs} />;
}
function Desktop({ fs }: { fs: VirtualFileSystem }) {
  const subscribe = useCallback((listener: () => void) => fs.subscribe(listener), [fs]);
  const revision = useSyncExternalStore(
    subscribe,
    () => fs.revision,
    () => 0,
  );
  const [settings, setSettings] = useState(() => {
    try {
      return loadSettings(localStorage);
    } catch {
      return defaultSettings;
    }
  });
  const [state, dispatch] = useReducer(windowReducer, undefined, () => {
    try {
      return settings.restoreSession
        ? restoreWindowSession(localStorage.getItem('browos:session'), knownApps)
        : initialWindowState;
    } catch {
      return initialWindowState;
    }
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [start, setStart] = useState(false);
  const [search, setSearch] = useState('');
  const [taskView, setTaskView] = useState(false);
  const [panel, setPanel] = useState<'notifications' | 'calendar' | 'volume' | null>(null);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [toast, setToast] = useState<SystemNotification | null>(null);
  const [clock, setClock] = useState(new Date());
  const [dialog, setDialog] = useState<FileDialogRequest | null>(null);
  const dialogRef = useRef<FileDialogRequest | null>(null);
  const guards = useRef(new Map<string, () => boolean>());
  const [locked, setLocked] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [masterVolume, setMasterVolume] = useState(70);
  const [folderName, setFolderName] = useState<string | null>(null);
  const initialized = useRef(false);
  const notify = useCallback((message: string, kind: 'info' | 'success' | 'error' = 'info') => {
    const item = { id: crypto.randomUUID(), title: 'BROwOS', message, kind, time: Date.now() };
    setNotifications((prev) => [item, ...prev].slice(0, 50));
    setToast(item);
  }, []);
  const openApp = useCallback(
    (appId: string, data?: Record<string, unknown>) => {
      const app = findApp(appId);
      if (!app) return;
      const current = stateRef.current;
      const existing = app.singleton ? current.windows.find((w) => w.appId === appId) : undefined;
      if (existing) {
        dispatch({ type: 'desktop', desktop: existing.desktop });
        dispatch({ type: 'focus', id: existing.id });
        setStart(false);
        return;
      }
      if (current.windows.length >= 30) {
        notify('Открыто 30 окон. Закройте несколько, чтобы продолжить.', 'error');
        return;
      }
      const step = (current.windows.length % 7) * 28;
      const bounds = clampBounds(
        {
          x: Math.max(40, (window.innerWidth - app.defaultSize.width) / 2 - 60) + step,
          y: 55 + step,
          ...app.defaultSize,
        },
        { width: window.innerWidth, height: window.innerHeight },
      );
      dispatch({
        type: 'open',
        window: {
          ...bounds,
          id: crypto.randomUUID(),
          appId,
          title: app.title,
          data,
          zIndex: 1,
          minimized: false,
          maximized: window.innerWidth < 650,
          snap: 'none',
          desktop: current.desktop,
          openedAt: Date.now(),
        },
      });
      setStart(false);
      setSearch('');
      setTaskView(false);
      setContext(null);
    },
    [notify],
  );
  const openFile = useCallback(
    (id: string) => {
      const node = fs.get(id);
      if (!node) return;
      if (node.kind === 'directory') {
        openApp('explorer', { folderId: id });
        return;
      }
      openApp(appForFile(node.name, node.mime), { fileId: id });
    },
    [fs, openApp],
  );
  const setTitle = useCallback(
    (id: string, title: string) => dispatch({ type: 'title', id, title }),
    [],
  );
  const setCloseGuard = useCallback((id: string, guard: (() => boolean) | null) => {
    if (guard) guards.current.set(id, guard);
    else guards.current.delete(id);
  }, []);
  const close = useCallback((id: string) => {
    if (guards.current.get(id)?.() === false) return;
    guards.current.delete(id);
    dispatch({ type: 'close', id });
  }, []);
  const openDialog = useCallback(
    (request: FileDialogRequest) => {
      if (dialogRef.current) {
        request.resolve(null);
        notify('Сначала завершите открытый диалог.');
        return;
      }
      dialogRef.current = request;
      setDialog(request);
    },
    [notify],
  );
  const pickFile = useCallback<DesktopServices['pickFile']>(
    (options = {}) => new Promise((resolve) => openDialog({ mode: 'open', ...options, resolve })),
    [openDialog],
  );
  const saveFile = useCallback<DesktopServices['saveFile']>(
    async (options) => {
      if (options.existingId) {
        try {
          await fs.updateFile(options.existingId, options.content, options.mime);
          return options.existingId;
        } catch (error) {
          notify(errorMessage(error), 'error');
          return null;
        }
      }
      return new Promise((resolve) => openDialog({ mode: 'save', ...options, resolve }));
    },
    [fs, notify, openDialog],
  );
  const services = useMemo<DesktopServices>(
    () => ({
      fs,
      revision,
      openApp,
      openFile,
      notify,
      setTitle,
      setCloseGuard,
      pickFile,
      saveFile,
    }),
    [fs, revision, openApp, openFile, notify, setTitle, setCloseGuard, pickFile, saveFile],
  );
  function finishDialog(id: string | null) {
    dialogRef.current?.resolve(id);
    dialogRef.current = null;
    setDialog(null);
  }
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      if (stateRef.current.windows.length === 0) openApp('welcome');
    }
  }, [openApp]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', resize);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    try {
      storeSettings(settings, localStorage);
    } catch {
      notify('Не удалось сохранить параметры браузера.', 'error');
    }
  }, [settings, notify]);
  useEffect(() => {
    if (!settings.restoreSession) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('browos:session', JSON.stringify(state));
      } catch {
        /* File content remains in IndexedDB even if session metadata quota is exhausted. */
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [state, settings.restoreSession]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (guards.current.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (dialogRef.current) return;
      if (event.ctrlKey && event.code === 'Space') {
        event.preventDefault();
        setStart((v) => !v);
        setSearch('');
      }
      if (event.key === 'Escape') {
        setStart(false);
        setPanel(null);
        setContext(null);
        setTaskView(false);
      }
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        dispatch({ type: 'show-desktop' });
      }
      if (event.ctrlKey && event.altKey && event.key === 'Tab') {
        event.preventDefault();
        const wins = stateRef.current.windows.filter((w) => w.desktop === stateRef.current.desktop);
        const i = wins.findIndex((w) => w.id === stateRef.current.activeId);
        const next = wins[(i + 1) % wins.length];
        if (next) dispatch({ type: 'focus', id: next.id });
      }
      if (event.ctrlKey && event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const id = stateRef.current.activeId;
        if (id) dispatch({ type: 'snap', id, side: event.key === 'ArrowLeft' ? 'left' : 'right' });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    document.querySelectorAll<HTMLMediaElement>('audio,video').forEach((element) => {
      element.volume = masterVolume / 100;
    });
  }, [masterVolume]);
  const desktopIcons = [
    {
      id: 'explorer',
      title: 'Этот компьютер',
      icon: 'computer',
      color: '#79caff',
      data: { folderId: 'root' },
    },
    {
      id: 'explorer',
      title: 'Корзина',
      icon: 'trash',
      color: '#b2d4e7',
      data: { folderId: 'trash' },
    },
    { id: 'browser', title: 'BROwser', icon: 'browser', color: '#22dbef' },
    {
      id: 'explorer',
      title: 'Документы',
      icon: 'folder',
      color: '#ffcc5a',
      data: { folderId: 'documents' },
    },
    { id: 'notepad', title: 'Блокнот', icon: 'notepad', color: '#88dfff' },
    { id: 'paint', title: 'Paint', icon: 'paint', color: '#ffbe9f' },
  ];
  const currentWindows = state.windows.filter((w) => w.desktop === state.desktop);
  const taskbarApps = [
    ...new Set(['explorer', 'browser', 'notepad', ...currentWindows.map((w) => w.appId)]),
  ];
  const foundApps = applications.filter((a) =>
    (a.title + ' ' + a.description + ' ' + a.id).toLowerCase().includes(search.toLowerCase()),
  );
  const foundFiles = search.trim() ? fs.search(search).slice(0, 6) : [];
  const formattedTime = clock.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: settings.showSeconds ? '2-digit' : undefined,
    hour12: !settings.clock24,
  });
  const date = clock.toLocaleDateString('ru-RU');
  function togglePanel(which: typeof panel) {
    setPanel(panel === which ? null : which);
    setStart(false);
    setTaskView(false);
  }
  async function createDesktopFolder() {
    if (folderName === null) return;
    try {
      await fs.mkdir('desktop', folderName);
      setFolderName(null);
      notify('Папка создана', 'success');
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  }
  return (
    <main
      className={`os-desktop theme-${settings.theme} wallpaper-${settings.wallpaper} ${settings.reduceMotion ? 'reduce-motion' : ''}`}
      style={{ '--accent': settings.accent } as CSSProperties}
    >
      <div
        className="desktop-background"
        onClick={() => {
          setStart(false);
          setPanel(null);
          setContext(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContext({
            x: Math.min(e.clientX, viewport.width - 240),
            y: Math.min(e.clientY, viewport.height - 250),
          });
        }}
      >
        <div className="light-beam beam-one" />
        <div className="light-beam beam-two" />
        <div className="wallpaper-mark">
          <Icon name="logo" size={240} />
        </div>
        <div className="wallpaper-wordmark">
          BROwOS<span>СВОБОДА БЫТЬ НА СВОЁМ МЕСТЕ</span>
        </div>
      </div>
      <div className="desktop-icons">
        {desktopIcons.map((item, i) => (
          <button
            key={i}
            className="desktop-icon"
            title={`${item.title} — двойной щелчок, чтобы открыть`}
            onDoubleClick={() => openApp(item.id, item.data)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openApp(item.id, item.data);
            }}
          >
            <AppIcon name={item.icon} size={43} color={item.color} />
            <span>{item.title}</span>
          </button>
        ))}
        {fs.list('desktop').map((node) => (
          <button
            key={node.id}
            className="desktop-icon"
            onDoubleClick={() => openFile(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openFile(node.id);
            }}
          >
            <AppIcon
              name={node.kind === 'directory' ? 'folder' : 'file'}
              color={node.kind === 'directory' ? '#ffce65' : '#deeffb'}
              size={40}
            />
            <span>{node.name}</span>
          </button>
        ))}
      </div>
      <div className="desktop-version">
        BROwOS <span>Local Edition</span>
        <small>
          v{VERSION} · Рабочий стол {state.desktop + 1}
        </small>
      </div>
      {state.windows.map((win) => {
        const manifest = findApp(win.appId)!;
        const Render = components[win.appId];
        const props = { services, windowId: win.id, data: win.data };
        return (
          <WindowFrame
            key={win.id}
            win={win}
            active={state.activeId === win.id}
            viewport={viewport}
            dispatch={dispatch}
            close={close}
            icon={manifest.icon}
            color={manifest.color}
            currentDesktop={state.desktop}
          >
            <AppBoundary name={manifest.title}>
              {win.appId === 'welcome' ? (
                <Welcome services={services} username={settings.username} />
              ) : win.appId === 'settings' ? (
                <SettingsApp
                  {...props}
                  settings={settings}
                  updateSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                />
              ) : win.appId === 'task-manager' ? (
                <TaskManagerApp {...props} windows={state.windows} closeWindow={close} />
              ) : Render ? (
                <Render {...props} />
              ) : null}
            </AppBoundary>
          </WindowFrame>
        );
      })}
      {context && (
        <div className="desktop-context-menu" style={{ left: context.x, top: context.y }}>
          <button
            onClick={() => {
              setFolderName('Новая папка');
              setContext(null);
            }}
          >
            <Icon name="folder" size={17} />
            Создать папку
          </button>
          <button
            onClick={() => {
              openApp('notepad');
              setContext(null);
            }}
          >
            <Icon name="file" size={17} />
            Текстовый документ
          </button>
          <hr />
          <button
            onClick={() => {
              openApp('explorer', { folderId: 'desktop' });
              setContext(null);
            }}
          >
            <Icon name="folder" size={17} />
            Открыть в Проводнике
          </button>
          <button
            onClick={() => {
              openApp('settings');
              setContext(null);
            }}
          >
            <Icon name="settings" size={17} />
            Персонализация
          </button>
          <button
            onClick={() => {
              openApp('task-manager');
              setContext(null);
            }}
          >
            <Icon name="chart" size={17} />
            Диспетчер задач
          </button>
        </div>
      )}
      {start && (
        <section className="start-menu" aria-label="Меню Пуск">
          <aside className="start-rail">
            <button
              title={settings.username}
              onClick={() => openApp('settings')}
              className="user-avatar"
            >
              {settings.username[0].toUpperCase()}
            </button>
            <div />
            <button
              title="Документы"
              onClick={() => openApp('explorer', { folderId: 'documents' })}
            >
              <Icon name="file" />
            </button>
            <button
              title="Изображения"
              onClick={() => openApp('explorer', { folderId: 'pictures' })}
            >
              <Icon name="photos" />
            </button>
            <button title="Параметры" onClick={() => openApp('settings')}>
              <Icon name="settings" />
            </button>
            <button
              title="Заблокировать рабочий стол"
              onClick={() => {
                setLocked(true);
                setStart(false);
              }}
            >
              <Icon name="power" />
            </button>
          </aside>
          <div className="start-list">
            <div className="start-list-label">
              {search ? 'Результаты поиска' : 'Все приложения'}
            </div>
            {foundApps.map((app) => (
              <button key={app.id} onClick={() => openApp(app.id)}>
                <span style={{ background: app.color }}>
                  <Icon name={app.icon} size={23} />
                </span>
                <div>
                  {app.title}
                  {search && <small>{app.description}</small>}
                </div>
              </button>
            ))}
            {foundFiles.length > 0 && (
              <>
                <div className="start-list-label">Файлы</div>
                {foundFiles.map((file) => (
                  <button key={file.id} onClick={() => openFile(file.id)}>
                    <Icon name={file.kind === 'directory' ? 'folder' : 'file'} />
                    <div>
                      {file.name}
                      <small>{fs.path(file.id)}</small>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
          {!search && (
            <div className="start-tiles">
              <p>Создавайте и исследуйте</p>
              <div className="tile-grid">
                <button className="tile tile-wide tile-browser" onClick={() => openApp('browser')}>
                  <Icon name="browser" size={43} />
                  <span>BROwser</span>
                  <small>Мир в одном окне</small>
                </button>
                <button className="tile tile-files" onClick={() => openApp('explorer')}>
                  <Icon name="folder" size={40} />
                  <span>Проводник</span>
                </button>
                <button className="tile tile-notes" onClick={() => openApp('notepad')}>
                  <Icon name="notepad" size={36} />
                  <span>Блокнот</span>
                </button>
                <button className="tile tile-paint" onClick={() => openApp('paint')}>
                  <Icon name="paint" size={39} />
                  <span>Paint</span>
                </button>
                <button className="tile tile-photos" onClick={() => openApp('photos')}>
                  <Icon name="photos" size={38} />
                  <span>Фотографии</span>
                </button>
                <button className="tile tile-wide tile-welcome" onClick={() => openApp('welcome')}>
                  <Icon name="logo" size={30} />
                  <span>Ваш BROwOS</span>
                  <small>Освойтесь. Создайте. Сохраните.</small>
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {taskView && (
        <div className="task-view">
          <header>
            <h2>Представление задач</h2>
            <button onClick={() => setTaskView(false)} aria-label="Закрыть представление задач">
              <Icon name="close" />
            </button>
          </header>
          <div className="desktop-switcher">
            {[0, 1].map((n) => (
              <button
                key={n}
                className={state.desktop === n ? 'selected' : ''}
                onClick={() => dispatch({ type: 'desktop', desktop: n })}
              >
                <Icon name="desktop" size={40} />
                <span>Рабочий стол {n + 1}</span>
                <small>{state.windows.filter((w) => w.desktop === n).length} окон</small>
              </button>
            ))}
          </div>
          <div className="task-view-windows">
            {currentWindows.map((win) => (
              <button
                key={win.id}
                onClick={() => {
                  dispatch({ type: 'focus', id: win.id });
                  setTaskView(false);
                }}
              >
                <AppIcon
                  name={findApp(win.appId)!.icon}
                  color={findApp(win.appId)!.color}
                  size={52}
                />
                <span>{win.title}</span>
                <small>{win.minimized ? 'Свёрнуто' : 'Открыто'}</small>
              </button>
            ))}
            {!currentWindows.length && (
              <p>Этот рабочий стол свободен. Откройте приложение из меню Пуск.</p>
            )}
          </div>
        </div>
      )}
      {panel && (
        <aside className={`system-panel panel-${panel}`}>
          {panel === 'notifications' && (
            <>
              <header>
                <h3>Центр уведомлений</h3>
                <button onClick={() => setNotifications([])}>Очистить</button>
              </header>
              <div className="notification-list">
                {notifications.length ? (
                  notifications.map((n) => (
                    <article key={n.id}>
                      <Icon name={n.kind === 'error' ? 'info' : 'notification'} size={20} />
                      <div>
                        <strong>{n.title}</strong>
                        <p>{n.message}</p>
                        <small>
                          {new Date(n.time).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </small>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="no-notifications">Новых уведомлений пока нет</p>
                )}
              </div>
              <div className="quick-actions">
                <button
                  onClick={() =>
                    setSettings((s) => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }))
                  }
                >
                  <Icon name="moon" />
                  <span>Тёмная тема</span>
                </button>
                <button onClick={() => openApp('settings')}>
                  <Icon name="settings" />
                  <span>Все параметры</span>
                </button>
                <button
                  onClick={() => {
                    setLocked(true);
                    setPanel(null);
                  }}
                >
                  <Icon name="lock" />
                  <span>Блокировка</span>
                </button>
                <button onClick={() => openApp('browser')}>
                  <Icon name="network" />
                  <span>Подключение</span>
                </button>
              </div>
            </>
          )}
          {panel === 'calendar' && (
            <>
              <div className="calendar-time">{formattedTime}</div>
              <p className="calendar-date">
                {clock.toLocaleDateString('ru-RU', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <Calendar date={clock} />
            </>
          )}
          {panel === 'volume' && (
            <>
              <h3>Звук BROwOS</h3>
              <div className="volume-control">
                <Icon name="volume" />
                <input
                  aria-label="Громкость медиаплееров"
                  type="range"
                  min="0"
                  max="100"
                  value={masterVolume}
                  onChange={(e) => setMasterVolume(Number(e.target.value))}
                />
                <span>{masterVolume}%</span>
              </div>
              <p>Громкость открытых аудио- и видеоплееров</p>
              <button className="app-button" onClick={() => openApp('media-player')}>
                Открыть медиаплеер
              </button>
            </>
          )}
        </aside>
      )}
      {toast && !panel && (
        <button
          className={`notification-toast toast-${toast.kind}`}
          onClick={() => {
            setPanel('notifications');
            setToast(null);
          }}
        >
          <Icon name="notification" size={24} />
          <span>
            <strong>BROwOS</strong>
            {toast.message}
          </span>
          <Icon name="forward" size={16} />
        </button>
      )}
      <footer className="taskbar">
        <button
          className={`start-button ${start ? 'active' : ''}`}
          aria-label="Пуск"
          title="Пуск (Ctrl + Пробел)"
          onClick={() => {
            setStart(!start);
            setPanel(null);
            setTaskView(false);
            setSearch('');
          }}
        >
          <Icon name="logo" size={21} />
        </button>
        <label className="taskbar-search">
          <Icon name="search" size={17} />
          <input
            aria-label="Поиск приложений и файлов"
            placeholder="Введите текст для поиска"
            value={search}
            onFocus={() => {
              setStart(true);
              setPanel(null);
            }}
            onChange={(e) => {
              setSearch(e.target.value);
              setStart(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && foundApps[0]) openApp(foundApps[0].id);
            }}
          />
        </label>
        <button
          className={`task-view-button ${taskView ? 'active' : ''}`}
          aria-label="Представление задач"
          title="Представление задач"
          onClick={() => {
            setTaskView(!taskView);
            setStart(false);
            setPanel(null);
          }}
        >
          <Icon name="grid" size={20} />
        </button>
        <div className="taskbar-apps">
          {taskbarApps.map((id) => {
            const app = findApp(id);
            if (!app) return null;
            const wins = currentWindows.filter((w) => w.appId === id);
            const active = wins.some((w) => w.id === state.activeId && !w.minimized);
            return (
              <button
                key={id}
                aria-label={`${app.title} на панели задач`}
                title={`${app.title}${wins.length > 1 ? ` (${wins.length})` : ''}`}
                className={`taskbar-app ${wins.length ? 'running' : ''} ${active ? 'active' : ''}`}
                onClick={() => {
                  const win = wins.sort((a, b) => b.zIndex - a.zIndex)[0];
                  if (!win) openApp(id);
                  else if (active) dispatch({ type: 'minimize', id: win.id });
                  else dispatch({ type: 'focus', id: win.id });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openApp(id);
                }}
              >
                <Icon name={app.icon} size={25} color={app.color} />
                {wins.length > 1 && <small>{wins.length}</small>}
              </button>
            );
          })}
        </div>
        <div className="system-tray">
          <button
            className="local-indicator"
            title="Файлы хранятся на этом устройстве"
            onClick={() => openApp('settings', { section: 'storage' })}
          >
            <span />
            Local
          </button>
          <button
            title={navigator.onLine ? 'Сеть доступна' : 'Нет подключения к сети'}
            aria-label="Подключение"
            onClick={() => openApp('browser')}
          >
            <Icon name="wifi" size={17} />
          </button>
          <button title="Громкость" aria-label="Громкость" onClick={() => togglePanel('volume')}>
            <Icon name="volume" size={17} />
          </button>
          <span className="language-indicator">РУС</span>
          <button
            className="tray-clock"
            onClick={() => togglePanel('calendar')}
            title="Дата и время"
          >
            <span>{formattedTime}</span>
            <small>{date}</small>
          </button>
          <button
            title="Центр уведомлений"
            aria-label="Центр уведомлений"
            className={notifications.length ? 'has-notifications' : ''}
            onClick={() => togglePanel('notifications')}
          >
            <Icon name="notification" size={19} />
          </button>
          <button
            className="show-desktop"
            title="Показать рабочий стол"
            aria-label="Показать рабочий стол"
            onClick={() =>
              dispatch({
                type: currentWindows.some((w) => !w.minimized) ? 'show-desktop' : 'restore-desktop',
              })
            }
          />
        </div>
      </footer>
      {folderName !== null && (
        <div className="modal-backdrop">
          <form
            className="text-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              void createDesktopFolder();
            }}
          >
            <h3>Создать папку</h3>
            <label>
              Имя папки
              <input
                autoFocus
                className="field-input"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
            </label>
            <div>
              <button type="button" className="app-button" onClick={() => setFolderName(null)}>
                Отмена
              </button>
              <button className="app-button primary" type="submit">
                Создать
              </button>
            </div>
          </form>
        </div>
      )}
      {dialog && <FileDialog request={dialog} fs={fs} finish={finishDialog} />}
      {locked && (
        <div className="lock-screen">
          <div className="lock-time">{formattedTime}</div>
          <p>
            {clock.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <div className="lock-user">
            <Icon name="user" size={55} />
            <h2>{settings.username}</h2>
            <button className="app-button primary" onClick={() => setLocked(false)}>
              Вернуться в BROwOS
            </button>
            <small>Экран блокировки без пароля</small>
          </div>
          <Icon name="logo" size={29} />
        </div>
      )}
    </main>
  );
}
function Welcome({ services, username }: { services: DesktopServices; username: string }) {
  const [page, setPage] = useState('home');
  return (
    <div className="welcome-app">
      <aside>
        <div className="welcome-brand">
          <Icon name="logo" size={34} />
          <span>BROwOS</span>
        </div>
        <nav>
          {[
            ['home', 'home', 'Добро пожаловать'],
            ['files', 'folder', 'Ваши файлы'],
            ['apps', 'grid', 'Приложения'],
            ['tips', 'book', 'Быстрый старт'],
          ].map(([id, icon, title]) => (
            <button className={page === id ? 'selected' : ''} key={id} onClick={() => setPage(id)}>
              <Icon name={icon} size={18} />
              {title}
            </button>
          ))}
        </nav>
        <div className="welcome-sidebar-bottom">
          <span className="status-dot" />
          Система готова<small>Local Edition · {VERSION}</small>
        </div>
      </aside>
      <article>
        {page === 'home' ? (
          <>
            <div className="welcome-eyebrow">ВАШЕ НОВОЕ РАБОЧЕЕ ПРОСТРАНСТВО</div>
            <h1>
              Привет, {username === 'Пользователь' ? 'это BROwOS' : username}.<br />
              <span>Чувствуйте себя дома.</span>
            </h1>
            <p className="welcome-lead">
              Знакомый рабочий стол, ваши файлы и любимые инструменты. Просто откройте браузер — и
              вы на месте.
            </p>
            <div className="welcome-feature-grid">
              <button onClick={() => services.openApp('explorer')}>
                <span className="feature-icon yellow">
                  <Icon name="folder" size={29} />
                </span>
                <strong>Всё по своим папкам</strong>
                <p>Создавайте, переносите и сохраняйте файлы.</p>
                <span className="feature-link">
                  Открыть Проводник <Icon name="forward" size={14} />
                </span>
              </button>
              <button onClick={() => services.openApp('browser')}>
                <span className="feature-icon cyan">
                  <Icon name="browser" size={29} />
                </span>
                <strong>Окно в большой мир</strong>
                <p>Вкладки, закладки и подключаемый Chromium.</p>
                <span className="feature-link">
                  Запустить BROwser <Icon name="forward" size={14} />
                </span>
              </button>
            </div>
            <div className="welcome-footer">
              <span>
                <Icon name="lock" size={16} />
                Ваши файлы остаются на этом устройстве
              </span>
              <button onClick={() => setPage('tips')}>
                Освоиться за минуту <Icon name="forward" size={14} />
              </button>
            </div>
          </>
        ) : page === 'files' ? (
          <>
            <div className="welcome-eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</div>
            <h1>Место для всего.</h1>
            <p className="welcome-lead">
              Перетащите файл с компьютера в Проводник. Создавайте папки, копируйте,
              переименовывайте и возвращайте файлы из корзины.
            </p>
            <div className="welcome-steps">
              <p>
                <b>01</b> Файлы сохраняются после перезагрузки страницы.
              </p>
              <p>
                <b>02</b> Блокнот и Paint работают с теми же папками.
              </p>
              <p>
                <b>03</b> Экспортируйте резервную копию в Параметрах.
              </p>
            </div>
            <button className="app-button primary" onClick={() => services.openApp('explorer')}>
              Открыть мои файлы
            </button>
            <p className="muted-note">
              Очистка данных сайта в браузере удаляет локальные файлы. Сохраняйте резервные копии
              важных документов.
            </p>
          </>
        ) : page === 'apps' ? (
          <>
            <div className="welcome-eyebrow">ИНСТРУМЕНТЫ ПОД РУКОЙ</div>
            <h1>Что будем делать?</h1>
            <div className="welcome-app-grid">
              {applications
                .filter((a) => !['welcome', 'settings', 'explorer', 'task-manager'].includes(a.id))
                .map((app) => (
                  <button key={app.id} onClick={() => services.openApp(app.id)}>
                    <AppIcon name={app.icon} color={app.color} />
                    <strong>{app.title}</strong>
                    <small>{app.description}</small>
                  </button>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="welcome-eyebrow">ОСВОЙТЕСЬ ЗА МИНУТУ</div>
            <h1>Знакомые движения.</h1>
            <div className="welcome-steps">
              <p>
                <b>01</b> Двойной щелчок по значку открывает приложение.
              </p>
              <p>
                <b>02</b> Перетащите окно к краю экрана, чтобы закрепить его.
              </p>
              <p>
                <b>03</b> Изменяйте размер за любой край или угол.
              </p>
              <p>
                <b>04</b> Откройте второй рабочий стол в Представлении задач.
              </p>
            </div>
            <div className="shortcut-list">
              <span>
                Открыть Пуск <kbd>Ctrl + Пробел</kbd>
              </span>
              <span>
                Переключить окно <kbd>Ctrl + Alt + Tab</kbd>
              </span>
              <span>
                Показать рабочий стол <kbd>Ctrl + Alt + D</kbd>
              </span>
              <span>
                Закрепить окно <kbd>Ctrl + Alt + ← / →</kbd>
              </span>
            </div>
            <p className="muted-note">
              BROwOS — самостоятельная веб-среда. Local-режим запускает веб-приложения; нативные
              .exe здесь не исполняются.
            </p>
          </>
        )}
      </article>
    </div>
  );
}
function Calendar({ date }: { date: Date }) {
  const offset = (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7;
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return (
    <div className="calendar">
      <h3>{date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h3>
      <div>
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((n) => (
          <strong key={n}>{n}</strong>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`blank${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => (
          <span className={i + 1 === date.getDate() ? 'today' : ''} key={i}>
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
