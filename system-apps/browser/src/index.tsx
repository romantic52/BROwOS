import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { AppProps } from '@browos/sdk';
import { Icon } from '@browos/ui';
import { errorMessage, normalizeWebUrl } from '@browos/shared';
import {
  ConnectedBrowserClient,
  ConnectedBrowserError,
  RemoteBrowserTabs,
  isBrowserAbort,
  remoteViewport,
} from './client';
import type { RemoteAction, RemoteSession } from './client';
import './style.css';

interface BrowserTab {
  id: string;
  url: string;
  title?: string;
  history: string[];
  index: number;
  reload: number;
  navigation: number;
}
const makeTab = (url = 'browos://home'): BrowserTab => ({
  id: crypto.randomUUID(),
  url,
  history: [url],
  index: 0,
  reload: 0,
  navigation: 0,
});
function readBookmarks(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('browos:bookmarks') || '[]');
    if (!Array.isArray(value)) return [];
    const bookmarks = new Set<string>();
    for (const item of value.slice(0, 100)) {
      if (typeof item !== 'string' || item.length > 4096) continue;
      try {
        const url = normalizeWebUrl(item);
        if (/^https?:/.test(url)) bookmarks.add(url);
      } catch {
        /* Invalid stored bookmarks are ignored. */
      }
    }
    return [...bookmarks].slice(0, 40);
  } catch {
    return [];
  }
}
function shortTitle(url: string): string {
  if (url.startsWith('browos:')) return 'Новая вкладка';
  if (url === 'about:blank') return 'Пустая страница';
  try {
    return new URL(url).hostname || 'Страница';
  } catch {
    return 'Вкладка';
  }
}

export function BrowserApp({ services, windowId, data }: AppProps) {
  const initial =
    typeof data?.url === 'string'
      ? (() => {
          try {
            return normalizeWebUrl(data.url);
          } catch {
            return 'browos://home';
          }
        })()
      : 'browos://home';
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [makeTab(initial)]);
  const [activeId, setActiveId] = useState('');
  const tab = tabs.find((item) => item.id === activeId) || tabs[0];
  const internal = tab.url.startsWith('browos:');
  const [address, setAddress] = useState(tab.url);
  const [bookmarks, setBookmarks] = useState(readBookmarks);
  const [showConnection, setShowConnection] = useState(false);
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:3001');
  const [token, setToken] = useState('');
  const [connection, setConnection] = useState<RemoteBrowserTabs | null>(null);
  const client = connection?.client ?? null;
  const connectionRef = useRef<RemoteBrowserTabs | null>(null);
  const candidateRef = useRef<RemoteBrowserTabs | null>(null);
  const connectionAttempt = useRef(0);
  const [remote, setRemote] = useState<RemoteSession | null>(null);
  const [frame, setFrame] = useState('');
  const frameRef = useRef('');
  const displayedSession = useRef<RemoteSession | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const remoteSurface = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const addressEditing = useRef(false);
  const alive = useRef(true);
  const activeTab = useRef(tab);
  activeTab.current = tab;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const closedTabs = useRef(new Set<string>());

  useEffect(() => {
    addressEditing.current = false;
    setAddress(tab.url);
    setError('');
    setShowHistory(false);
  }, [tab.id]);
  useEffect(() => {
    if (!addressEditing.current) setAddress(tab.url);
    services.setTitle(windowId, `${tab.title || shortTitle(tab.url)} — BROwser`);
  }, [tab.url, tab.title, tab.id, services.setTitle, windowId]);
  useEffect(() => {
    try {
      localStorage.setItem('browos:bookmarks', JSON.stringify(bookmarks));
    } catch {
      services.notify('Не удалось сохранить закладки', 'error');
    }
  }, [bookmarks, services.notify]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      connectionAttempt.current += 1;
      void connectionRef.current?.dispose();
      void candidateRef.current?.dispose();
      connectionRef.current = null;
      candidateRef.current = null;
      if (frameRef.current) URL.revokeObjectURL(frameRef.current);
      frameRef.current = '';
      displayedSession.current = null;
    };
  }, []);

  function updateTab(id: string, update: (current: BrowserTab) => BrowserTab) {
    if (alive.current && !closedTabs.current.has(id))
      setTabs((previous) =>
        previous.map((current) => (current.id === id ? update(current) : current)),
      );
  }
  function currentView(pool: RemoteBrowserTabs, id: string, navigation: number): boolean {
    return (
      alive.current &&
      connectionRef.current === pool &&
      !closedTabs.current.has(id) &&
      activeTab.current.id === id &&
      activeTab.current.navigation === navigation &&
      !activeTab.current.url.startsWith('browos:')
    );
  }
  function clearFrame() {
    if (frameRef.current) URL.revokeObjectURL(frameRef.current);
    frameRef.current = '';
    displayedSession.current = null;
    if (alive.current) setFrame('');
  }
  function showFrame(
    pool: RemoteBrowserTabs,
    id: string,
    navigation: number,
    session: RemoteSession,
    blob: Blob,
  ) {
    if (!currentView(pool, id, navigation)) return;
    const next = URL.createObjectURL(blob);
    if (frameRef.current) URL.revokeObjectURL(frameRef.current);
    frameRef.current = next;
    displayedSession.current = session;
    setFrame(next);
  }
  function dimensions() {
    const rect = remoteSurface.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? remoteViewport(rect.width, rect.height)
      : remoteViewport(1280, 720);
  }
  function syncSession(
    pool: RemoteBrowserTabs,
    id: string,
    navigation: number,
    session: RemoteSession,
    hint: 'replace' | 'back' | 'forward' | 'observe' = 'observe',
  ) {
    if (!alive.current || connectionRef.current !== pool || closedTabs.current.has(id)) return;
    updateTab(id, (current) => {
      if (current.navigation !== navigation) return current;
      if (current.url === session.url && current.title === session.title) return current;
      if (current.url === session.url) return { ...current, title: session.title };
      let history = current.history;
      let index = current.index;
      if (hint === 'replace')
        history = history.map((url, at) => (at === index ? session.url : url));
      else {
        const previous = hint === 'back' ? history.slice(0, index).lastIndexOf(session.url) : -1;
        const next = hint === 'forward' ? history.indexOf(session.url, index + 1) : -1;
        if (previous >= 0) index = previous;
        else if (next >= 0) index = next;
        else {
          history = [...history.slice(0, index + 1), session.url].slice(-200);
          index = history.length - 1;
        }
      }
      return { ...current, url: session.url, title: session.title, history, index };
    });
    if (currentView(pool, id, navigation)) setRemote(session);
  }

  function navigate(value: string, replace = false) {
    let url: string;
    try {
      url = normalizeWebUrl(value);
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    const current = activeTab.current;
    addressEditing.current = false;
    setAddress(url);
    setError('');
    setStatus('');
    updateTab(current.id, (item) => {
      const history = replace
        ? item.history.map((entry, index) => (index === item.index ? url : entry))
        : [...item.history.slice(0, item.index + 1), url].slice(-200);
      return {
        ...item,
        url,
        title: undefined,
        history,
        index: replace ? item.index : history.length - 1,
        navigation: item.navigation + 1,
      };
    });
  }

  async function action(payload: RemoteAction): Promise<boolean> {
    const pool = connectionRef.current;
    const current = activeTab.current;
    if (!pool || !pool.peek(current.id) || current.url.startsWith('browos:')) return false;
    try {
      const result = await pool.action(current.id, payload);
      syncSession(
        pool,
        current.id,
        current.navigation,
        result,
        payload.type === 'back' || payload.type === 'forward' ? payload.type : 'observe',
      );
      return true;
    } catch (cause) {
      if (!isBrowserAbort(cause) && currentView(pool, current.id, current.navigation))
        setError(errorMessage(cause));
      return false;
    }
  }

  useEffect(() => {
    clearFrame();
    setRemote(null);
    setStatus('');
    if (!connection || internal) return;
    const pool = connection;
    const id = tab.id;
    const navigation = tab.navigation;
    let cancelled = false;
    let ready = false;
    let polling = false;
    let failures = 0;
    let pauseUntil = 0;
    let lastMetadata = 0;
    const controller = new AbortController();
    async function poll() {
      if (
        cancelled ||
        !ready ||
        polling ||
        pool.isBusy(id) ||
        Date.now() < pauseUntil ||
        document.visibilityState === 'hidden'
      )
        return;
      const surface = remoteSurface.current;
      if (!surface || surface.clientWidth === 0 || surface.clientHeight === 0) return;
      polling = true;
      try {
        const refreshState = Date.now() - lastMetadata >= 1000;
        const captured = await pool.capture(id, refreshState, controller.signal);
        if (cancelled || !currentView(pool, id, navigation)) return;
        if (refreshState) lastMetadata = Date.now();
        syncSession(pool, id, navigation, captured.session);
        showFrame(pool, id, navigation, captured.session, captured.blob);
        if (failures) setError('');
        failures = 0;
      } catch (cause) {
        if (cancelled || isBrowserAbort(cause) || !currentView(pool, id, navigation)) return;
        failures += 1;
        if (cause instanceof ConnectedBrowserError && [401, 403, 404].includes(cause.status)) {
          ready = false;
          clearFrame();
          setRemote(null);
          if (cause.status === 404) void pool.closeTab(id);
          setError(
            cause.status === 404
              ? 'Серверная сессия закрыта или истекла. Обновите вкладку, чтобы открыть новую.'
              : errorMessage(cause),
          );
        } else {
          pauseUntil =
            Date.now() +
            (cause instanceof ConnectedBrowserError && cause.retryAfterMs
              ? cause.retryAfterMs
              : Math.min(15_000, 350 * 2 ** failures));
          if (failures >= 3 || (cause instanceof ConnectedBrowserError && cause.status === 429))
            setError(errorMessage(cause));
        }
      } finally {
        polling = false;
      }
    }
    async function start() {
      const viewport = dimensions();
      const existing = pool.hasNavigation(id, navigation);
      if (!existing) setStatus('Открываем страницу в Chromium…');
      try {
        const session = await pool.navigate(
          id,
          tab.url,
          navigation,
          viewport.width,
          viewport.height,
        );
        if (cancelled || !currentView(pool, id, navigation)) return;
        syncSession(pool, id, navigation, session, existing ? 'observe' : 'replace');
        setStatus('');
        ready = true;
        await poll();
      } catch (cause) {
        if (!cancelled && !isBrowserAbort(cause) && currentView(pool, id, navigation)) {
          setError(errorMessage(cause));
          setStatus('');
        }
      }
    }
    void start();
    const timer = setInterval(() => void poll(), 350);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [connection, tab.id, tab.navigation, internal]);

  useEffect(() => {
    const surface = remoteSurface.current;
    if (!surface || !connection || internal) return;
    let deltaX = 0;
    let deltaY = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      deltaX = Math.max(-5000, Math.min(5000, deltaX + event.deltaX));
      deltaY = Math.max(-5000, Math.min(5000, deltaY + event.deltaY));
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void action({ type: 'wheel', deltaX, deltaY });
        deltaX = 0;
        deltaY = 0;
      }, 80);
    };
    surface.addEventListener('wheel', wheel, { passive: false });
    return () => {
      surface.removeEventListener('wheel', wheel);
      if (timer) clearTimeout(timer);
    };
  }, [connection, tab.id, internal]);

  useEffect(() => {
    const surface = remoteSurface.current;
    if (!surface || !connection || internal || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const current = connection.peek(tab.id);
        const rect = surface.getBoundingClientRect();
        if (
          !current ||
          !rect.width ||
          !rect.height ||
          connectionRef.current !== connection ||
          activeTab.current.id !== tab.id
        )
          return;
        const viewport = remoteViewport(rect.width, rect.height);
        if (current.width !== viewport.width || current.height !== viewport.height)
          void action({ type: 'resize', ...viewport });
      }, 180);
    });
    observer.observe(surface);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [connection, tab.id, internal, remote?.id]);

  async function connect() {
    if (busy) return;
    const attempt = ++connectionAttempt.current;
    setConnectionError('');
    setBusy(true);
    let candidate: RemoteBrowserTabs | undefined;
    try {
      candidate = new RemoteBrowserTabs(new ConnectedBrowserClient(endpoint, token));
      candidateRef.current = candidate;
      const id = activeTab.current.id;
      const viewport = dimensions();
      await candidate.ensure(id, viewport.width, viewport.height);
      if (
        !alive.current ||
        attempt !== connectionAttempt.current ||
        candidateRef.current !== candidate
      ) {
        await candidate.dispose();
        return;
      }
      const previous = connectionRef.current;
      if (closedTabs.current.has(id)) await candidate.closeTab(id);
      connectionRef.current = candidate;
      candidateRef.current = null;
      setConnection(candidate);
      clearFrame();
      setRemote(null);
      setToken('');
      setShowConnection(false);
      void previous?.dispose();
      services.notify('Подключено к серверному Chromium', 'success');
    } catch (cause) {
      void candidate?.dispose();
      if (alive.current && attempt === connectionAttempt.current && !isBrowserAbort(cause))
        setConnectionError(errorMessage(cause));
    } finally {
      if (candidateRef.current === candidate) candidateRef.current = null;
      if (alive.current && attempt === connectionAttempt.current) setBusy(false);
    }
  }

  function disconnect() {
    connectionAttempt.current += 1;
    const previous = connectionRef.current;
    const candidate = candidateRef.current;
    connectionRef.current = null;
    candidateRef.current = null;
    setConnection(null);
    setRemote(null);
    setStatus('');
    setError('');
    setBusy(false);
    setToken('');
    clearFrame();
    void previous?.dispose();
    void candidate?.dispose();
    services.notify('Включён Local-режим. Закрытие серверных вкладок запрошено.');
  }
  function newTab() {
    if (tabsRef.current.length >= 12) {
      services.notify('Открыто 12 вкладок. Закройте ненужные.');
      return;
    }
    const next = makeTab();
    setTabs((previous) => [...previous, next]);
    setActiveId(next.id);
  }
  function closeTab(id: string) {
    closedTabs.current.add(id);
    void connectionRef.current?.closeTab(id);
    void candidateRef.current?.closeTab(id);
    const previous = tabsRef.current;
    const next = previous.filter((item) => item.id !== id);
    if (!next.length) {
      const blank = makeTab();
      setTabs([blank]);
      setActiveId(blank.id);
    } else {
      setTabs(next);
      if (activeTab.current.id === id)
        setActiveId(
          next[Math.max(0, previous.findIndex((item) => item.id === id) - 1)]?.id || next[0].id,
        );
    }
  }
  function historyMove(delta: number) {
    const current = activeTab.current;
    if (remote && connectionRef.current?.peek(current.id) && !current.url.startsWith('browos:')) {
      void action({ type: delta < 0 ? 'back' : 'forward' });
      return;
    }
    const index = current.index + delta;
    if (index < 0 || index >= current.history.length) return;
    updateTab(current.id, (item) => ({
      ...item,
      index,
      url: item.history[index],
      title: undefined,
      navigation: item.navigation + 1,
    }));
  }
  function refresh() {
    const current = activeTab.current;
    if (remote && connectionRef.current?.peek(current.id) && !current.url.startsWith('browos:')) {
      void action({ type: 'reload' });
      return;
    }
    updateTab(current.id, (item) => ({
      ...item,
      reload: item.reload + 1,
      navigation: item.navigation + 1,
    }));
  }
  function openExternal() {
    try {
      const url = normalizeWebUrl(address);
      if (/^https?:/.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  function remoteClick(event: MouseEvent<HTMLDivElement>) {
    const visible = displayedSession.current;
    if (
      !remote ||
      !visible ||
      visible.id !== remote.id ||
      visible.width !== remote.width ||
      visible.height !== remote.height
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / remote.width, rect.height / remote.height);
    if (!Number.isFinite(scale) || scale <= 0) return;
    const x = (event.clientX - rect.left - (rect.width - remote.width * scale) / 2) / scale;
    const y = (event.clientY - rect.top - (rect.height - remote.height * scale) / 2) / scale;
    if (x < 0 || y < 0 || x >= remote.width || y >= remote.height) return;
    event.currentTarget.focus();
    void action({
      type: 'click',
      x: Math.min(remote.width - 1, Math.round(x)),
      y: Math.min(remote.height - 1, Math.round(y)),
      button: event.button === 2 ? 'right' : 'left',
      clickCount: 1,
    });
  }
  async function sendText(text: string): Promise<boolean> {
    if (text.length > 2048) {
      setError('За один раз можно передать не более 2048 символов');
      return false;
    }
    return text ? action({ type: 'text', text }) : false;
  }
  async function submitText(form: HTMLFormElement) {
    const text = new FormData(form).get('text');
    const owner = activeTab.current;
    if (typeof text !== 'string' || !text) return;
    if (
      (await sendText(text)) &&
      activeTab.current.id === owner.id &&
      activeTab.current.navigation === owner.navigation &&
      new FormData(form).get('text') === text
    )
      form.reset();
  }
  function closeConnectionDialog() {
    setShowConnection(false);
    if (!busy) return;
    connectionAttempt.current += 1;
    const candidate = candidateRef.current;
    candidateRef.current = null;
    void candidate?.dispose();
    setBusy(false);
  }
  function remoteKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!remote || event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      addressRef.current?.focus();
      addressRef.current?.select();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
    if (
      [
        'Shift',
        'Control',
        'Alt',
        'Meta',
        'AltGraph',
        'CapsLock',
        'NumLock',
        'Dead',
        'Process',
        'Unidentified',
      ].includes(event.key)
    )
      return;
    if (Array.from(event.key).length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      sendText(event.key);
      return;
    }
    const modifiers = [
      event.ctrlKey ? 'Control' : '',
      event.metaKey ? 'Meta' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    const key = [...modifiers, event.key === ' ' ? 'Space' : event.key].join('+');
    if (
      !/^(?:(?:Control|ControlOrMeta|Alt|Shift|Meta)\+){0,4}(?:[a-zA-Z0-9]|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|F(?:[1-9]|1[0-2]))$/.test(
        key,
      )
    )
      return;
    event.preventDefault();
    void action({ type: 'key', key });
  }
  return (
    <div
      className="browser-app"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
          e.preventDefault();
          addressRef.current?.focus();
          addressRef.current?.select();
        }
      }}
    >
      <div className="browser-tabs" role="tablist" aria-label="Вкладки браузера">
        {tabs.map((t) => (
          <div className={`browser-tab ${t.id === tab.id ? 'selected' : ''}`} key={t.id}>
            <button role="tab" aria-selected={t.id === tab.id} onClick={() => setActiveId(t.id)}>
              <Icon name={t.url.startsWith('browos:') ? 'logo' : 'browser'} size={15} />
              <span>{t.title || shortTitle(t.url)}</span>
            </button>
            <button
              aria-label={`Закрыть вкладку ${shortTitle(t.url)}`}
              onClick={() => void closeTab(t.id)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button
          className="new-tab"
          title="Новая вкладка"
          aria-label="Новая вкладка"
          onClick={newTab}
        >
          <Icon name="plus" size={17} />
        </button>
      </div>
      <div className="browser-toolbar">
        <button
          aria-label="Назад"
          title="Назад"
          disabled={!remote && tab.index === 0}
          onClick={() => historyMove(-1)}
        >
          <Icon name="back" size={18} />
        </button>
        <button
          aria-label="Вперёд"
          title="Вперёд"
          disabled={!remote && tab.index >= tab.history.length - 1}
          onClick={() => historyMove(1)}
        >
          <Icon name="forward" size={18} />
        </button>
        <button aria-label="Обновить страницу" title="Обновить" onClick={refresh}>
          <Icon name="refresh" size={17} />
        </button>
        <button aria-label="Домой" title="Домой" onClick={() => void navigate('browos://home')}>
          <Icon name="home" size={17} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void navigate(address);
          }}
        >
          <Icon
            name={internal ? 'logo' : tab.url.startsWith('https:') ? 'lock' : 'browser'}
            size={15}
          />
          <input
            ref={addressRef}
            aria-label="Адрес сайта"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              addressEditing.current = true;
              e.target.select();
            }}
            onBlur={() => {
              addressEditing.current = false;
            }}
            placeholder="Введите адрес или поисковый запрос"
          />
          <button title="Перейти" aria-label="Перейти" type="submit">
            <Icon name="forward" size={16} />
          </button>
          <button
            type="button"
            title="Добавить в закладки"
            aria-label="Добавить в закладки"
            disabled={!/^https?:/.test(tab.url)}
            className={bookmarks.includes(tab.url) ? 'bookmarked' : ''}
            onClick={() =>
              setBookmarks((prev) =>
                prev.includes(tab.url)
                  ? prev.filter((u) => u !== tab.url)
                  : [...prev, tab.url].slice(0, 40),
              )
            }
          >
            <Icon name="star" size={17} />
          </button>
        </form>
        <button
          title="История вкладки"
          aria-label="История вкладки"
          onClick={() => setShowHistory(!showHistory)}
        >
          <Icon name="clock" size={18} />
        </button>
        <button
          title="Открыть во внешнем браузере"
          aria-label="Открыть во внешнем браузере"
          disabled={!/^https?:/.test(tab.url)}
          onClick={openExternal}
        >
          <Icon name="external" size={17} />
        </button>
      </div>
      <div className="browser-bookmarks">
        <button onClick={() => void navigate('browos://home')}>
          <Icon name="home" size={13} />
          Начальная страница
        </button>
        {bookmarks.map((url) => (
          <button
            key={url}
            title={url}
            onClick={() => void navigate(url)}
            onContextMenu={(e) => {
              e.preventDefault();
              setBookmarks((prev) => prev.filter((v) => v !== url));
            }}
          >
            <Icon name="star" size={12} />
            {shortTitle(url)}
          </button>
        ))}
        <span />
        <button
          className={`browser-mode ${client ? 'connected' : ''}`}
          onClick={() => setShowConnection(true)}
        >
          <span className="status-dot" />
          {client ? 'Connected · Chromium' : 'Local'}
          <Icon name="down" size={12} />
        </button>
      </div>
      {showHistory && (
        <div className="browser-history">
          <h3>История этой вкладки</h3>
          {tab.history
            .slice()
            .reverse()
            .map((url, i) => (
              <button key={i} onClick={() => void navigate(url)}>
                <Icon name="clock" size={14} />
                <span>{url}</span>
              </button>
            ))}
        </div>
      )}
      {error && (
        <div className="browser-error" role="alert">
          <Icon name="info" size={17} />
          <span>{error}</span>
          <button aria-label="Скрыть ошибку" onClick={() => setError('')}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {internal ? (
        <section className="browser-home">
          <div className="browser-home-logo">
            <Icon name="browser" size={53} />
            <span>BROwser</span>
          </div>
          <h1>Куда отправимся сегодня?</h1>
          <form
            className="browser-home-search"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('query');
              if (typeof value === 'string') void navigate(value);
            }}
          >
            <Icon name="search" size={21} />
            <input
              name="query"
              aria-label="Поиск в интернете"
              placeholder="Найдите что-нибудь интересное"
            />
            <button type="submit" aria-label="Искать">
              <Icon name="forward" size={20} />
            </button>
          </form>
          <div className="browser-shortcuts">
            {[
              ['https://example.com', 'Пример сайта', 'browser', '#1975b8'],
              ['https://www.wikipedia.org', 'Википедия', 'book', '#69717b'],
              ['https://developer.mozilla.org', 'MDN Web Docs', 'file', '#388664'],
              ['https://github.com/romantic52/BROwOS', 'BROwOS на GitHub', 'terminal', '#6960a4'],
            ].map(([url, title, icon, color]) => (
              <button key={url} onClick={() => void navigate(url)}>
                <span style={{ color, background: color + '15' }}>
                  <Icon name={icon} size={26} />
                </span>
                <strong>{title}</strong>
              </button>
            ))}
          </div>
          <div className="browser-home-card">
            <Icon name={client ? 'check' : 'network'} size={28} />
            <div>
              <strong>{client ? 'Chromium подключён' : 'Больше свободы с Connected'}</strong>
              <p>
                {client
                  ? 'Страницы исполняются в отдельной серверной сессии.'
                  : 'Подключите свой сервер Chromium, чтобы управлять настоящим браузером внутри BROwOS.'}
              </p>
            </div>
            <button className="app-button" onClick={() => setShowConnection(true)}>
              {client ? 'Управление' : 'Подключить'}
            </button>
          </div>
          <p className="browser-home-note">
            {client
              ? 'Токен хранится только в памяти этой вкладки.'
              : 'Local отображает сайты, разрешающие встраивание. Некоторые страницы открываются только во внешней вкладке или Connected-режиме.'}
          </p>
        </section>
      ) : client ? (
        <div className="remote-wrapper">
          {status && <div className="remote-status">{status}</div>}
          <div
            ref={remoteSurface}
            className="remote-surface"
            tabIndex={0}
            role="application"
            aria-label="Удалённый Chromium"
            onClick={remoteClick}
            onContextMenu={(e) => {
              e.preventDefault();
              remoteClick(e);
            }}
            onKeyDown={remoteKey}
            onCompositionEnd={(e) => {
              if (e.data) sendText(e.data);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (text) {
                e.preventDefault();
                sendText(text);
              }
            }}
          >
            {frame ? (
              <img src={frame} alt="Страница серверного Chromium" draggable={false} />
            ) : (
              <div className="remote-loading">
                <div className="boot-spinner" />
                <p>Открываем серверную вкладку…</p>
              </div>
            )}
          </div>
          <div className="remote-input-bar">
            <span>
              <Icon name="lock" size={12} />
              Изолированная сессия Chromium
            </span>
            <button onClick={() => void action({ type: 'key', key: 'Control+A' })}>
              Выделить всё
            </button>
            <button onClick={() => void action({ type: 'key', key: 'Backspace' })}>⌫</button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitText(e.currentTarget);
              }}
            >
              <input
                name="text"
                maxLength={2048}
                aria-label="Текст для удалённой страницы"
                placeholder="Ввести текст в страницу…"
              />
              <button type="submit">Ввести</button>
            </form>
          </div>
        </div>
      ) : (
        <div className="local-browser-frame">
          <div className="iframe-note">
            <Icon name="info" size={15} />
            <span>
              Сайт может запрещать встраивание. Если страница пуста — откройте её отдельно или
              подключите Chromium.
            </span>
            <button onClick={() => setShowConnection(true)}>Connected</button>
          </div>
          <iframe
            key={`${tab.id}-${tab.reload}`}
            src={tab.url}
            title={`Сайт ${shortTitle(tab.url)}`}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-popups"
            onLoad={() => setStatus('')}
          />
        </div>
      )}
      {showConnection && (
        <div className="browser-modal">
          <form
            className="connection-dialog"
            role="dialog"
            aria-label="Подключение Chromium"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <header>
              <Icon name="network" size={27} />
              <button
                type="button"
                aria-label="Закрыть подключение"
                onClick={closeConnectionDialog}
              >
                <Icon name="close" size={18} />
              </button>
            </header>
            <h2>Ваш браузер. Ваш сервер.</h2>
            <p>
              Подключитесь к Connected Edition BROwOS. Статическая демоверсия не включает сервер.
            </p>
            <label>
              Адрес сервера
              <input
                aria-label="Адрес сервера Chromium"
                className="field-input"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://browos.example.com"
                required
                type="url"
              />
            </label>
            <label>
              Токен доступа
              <input
                aria-label="Токен доступа Chromium"
                className="field-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                minLength={32}
                maxLength={256}
                placeholder="BROWOS_ACCESS_TOKEN"
                required
              />
            </label>
            <small>
              Токен остаётся в памяти браузера и передаётся только указанному вами серверу. В
              репозиторий, файлы и localStorage он не записывается.
            </small>
            {connectionError && (
              <p className="inline-error" role="alert">
                {connectionError}
              </p>
            )}
            <div className="connection-actions">
              {client && (
                <button
                  type="button"
                  className="app-button"
                  onClick={() => {
                    void disconnect();
                    setShowConnection(false);
                  }}
                >
                  Отключить
                </button>
              )}
              <a
                href="https://github.com/romantic52/BROwOS/blob/main/docs/CONNECTED.md"
                target="_blank"
                rel="noreferrer"
              >
                Как запустить сервер
              </a>
              <button className="app-button primary" type="submit" disabled={busy}>
                {busy ? 'Подключаем…' : 'Подключиться'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
