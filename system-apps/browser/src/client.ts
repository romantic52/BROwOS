export interface RemoteSession {
  id: string;
  url: string;
  title: string;
  width: number;
  height: number;
  createdAt: string;
  lastActivityAt: string;
}

export type RemoteAction =
  | {
      type: 'click';
      x: number;
      y: number;
      button?: 'left' | 'middle' | 'right';
      clickCount?: 1 | 2;
    }
  | { type: 'move'; x: number; y: number }
  | { type: 'wheel'; deltaX: number; deltaY: number }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string }
  | { type: 'back' | 'forward' | 'reload' }
  | { type: 'resize'; width: number; height: number };

export class ConnectedBrowserError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'ConnectedBrowserError';
  }
}

export function remoteViewport(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.round(Math.max(320, Math.min(1920, Number.isFinite(width) ? width : 1280))),
    height: Math.round(Math.max(240, Math.min(1080, Number.isFinite(height) ? height : 720))),
  };
}

const aborted = (): DOMException => new DOMException('Операция отменена', 'AbortError');
export const isBrowserAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

function linkedSignals(signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController();
  const cleanup: (() => void)[] = [];
  for (const signal of signals) {
    if (!signal) continue;
    const abort = () => controller.abort(signal.reason ?? aborted());
    if (signal.aborted) abort();
    else {
      signal.addEventListener('abort', abort, { once: true });
      cleanup.push(() => signal.removeEventListener('abort', abort));
    }
  }
  return {
    signal: controller.signal,
    abort: (reason: unknown) => controller.abort(reason),
    dispose: () => cleanup.forEach((remove) => remove()),
  };
}

function sessionSnapshot(value: unknown): RemoteSession {
  const invalid = (): never => {
    throw new ConnectedBrowserError(
      502,
      'INVALID_RESPONSE',
      'Сервер вернул некорректное описание вкладки',
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{32}$/.test(v.id) ||
    typeof v.url !== 'string' ||
    v.url.length > 4096 ||
    typeof v.title !== 'string'
  )
    return invalid();
  if (
    !Number.isInteger(v.width) ||
    !Number.isInteger(v.height) ||
    (v.width as number) < 320 ||
    (v.width as number) > 1920 ||
    (v.height as number) < 240 ||
    (v.height as number) > 1080
  )
    return invalid();
  if (
    typeof v.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(v.createdAt)) ||
    typeof v.lastActivityAt !== 'string' ||
    !Number.isFinite(Date.parse(v.lastActivityAt))
  )
    return invalid();
  if (v.url !== 'about:blank') {
    try {
      const url = new URL(v.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        return invalid();
    } catch {
      return invalid();
    }
  }
  return {
    id: v.id,
    url: v.url,
    title: v.title.slice(0, 512),
    width: v.width as number,
    height: v.height as number,
    createdAt: v.createdAt,
    lastActivityAt: v.lastActivityAt,
  };
}

/** Authenticated fetches only: the access token never appears in a URL or browser storage. */
export class ConnectedBrowserClient {
  readonly endpoint: string;
  constructor(
    endpoint: string,
    private readonly token: string,
  ) {
    const url = new URL(endpoint);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      throw new Error('Используйте HTTPS или локальный сервер на localhost');
    if (url.username || url.password || url.search || url.hash)
      throw new Error('Адрес сервера не должен содержать пароль или параметры');
    if (token.length < 32 || token.length > 256 || /\s/.test(token))
      throw new Error('Токен подключения должен содержать от 32 до 256 символов без пробелов');
    this.endpoint = url.href.replace(/\/+$/, '');
  }

  private async request<T>(
    path: string,
    method: string,
    body: unknown,
    signal: AbortSignal | undefined,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const linked = linkedSignals([signal]);
    const timer = setTimeout(
      () => linked.abort(new DOMException('Сервер не ответил вовремя', 'TimeoutError')),
      method === 'DELETE' ? 5000 : 35_000,
    );
    try {
      const response = await fetch(`${this.endpoint}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: linked.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) {
        const value: unknown = await response.json().catch(() => null);
        const detail =
          value &&
          typeof value === 'object' &&
          'error' in value &&
          value.error &&
          typeof value.error === 'object'
            ? (value.error as Record<string, unknown>)
            : undefined;
        const message =
          typeof detail?.message === 'string'
            ? detail.message.slice(0, 1000)
            : `Сервер ответил ${response.status}`;
        const code = typeof detail?.code === 'string' ? detail.code : 'HTTP_ERROR';
        const retrySeconds = Number(
          response.headers.get('Retry-After') ?? (response.status === 429 ? 60 : 0),
        );
        throw new ConnectedBrowserError(
          response.status,
          code,
          message,
          Number.isFinite(retrySeconds) ? Math.max(0, Math.min(300_000, retrySeconds * 1000)) : 0,
        );
      }
      return await consume(response);
    } finally {
      clearTimeout(timer);
      linked.dispose();
    }
  }

  private async snapshot(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<RemoteSession> {
    return sessionSnapshot(
      await this.request(path, method, body, signal, async (response) => {
        try {
          return (await response.json()) as unknown;
        } catch (error) {
          if (isBrowserAbort(error) || (error instanceof Error && error.name === 'TimeoutError'))
            throw error;
          throw new ConnectedBrowserError(
            502,
            'INVALID_RESPONSE',
            'Сервер вернул некорректный JSON',
          );
        }
      }),
    );
  }

  create(width = 1280, height = 720, signal?: AbortSignal): Promise<RemoteSession> {
    return this.snapshot('/api/sessions', 'POST', remoteViewport(width, height), signal);
  }
  state(id: string, signal?: AbortSignal): Promise<RemoteSession> {
    return this.snapshot(`/api/sessions/${encodeURIComponent(id)}`, 'GET', undefined, signal);
  }
  navigate(id: string, url: string, signal?: AbortSignal): Promise<RemoteSession> {
    return this.snapshot(
      `/api/sessions/${encodeURIComponent(id)}/navigate`,
      'POST',
      { url },
      signal,
    );
  }
  action(id: string, action: RemoteAction, signal?: AbortSignal): Promise<RemoteSession> {
    return this.snapshot(`/api/sessions/${encodeURIComponent(id)}/action`, 'POST', action, signal);
  }
  frame(id: string, signal?: AbortSignal): Promise<Blob> {
    return this.request(
      `/api/sessions/${encodeURIComponent(id)}/frame`,
      'GET',
      undefined,
      signal,
      async (response) => {
        if (response.headers.get('Content-Type')?.split(';')[0] !== 'image/jpeg')
          throw new ConnectedBrowserError(
            502,
            'INVALID_FRAME',
            'Сервер вернул некорректное изображение страницы',
          );
        return response.blob();
      },
    );
  }
  async close(id: string): Promise<void> {
    try {
      await this.request(
        `/api/sessions/${encodeURIComponent(id)}`,
        'DELETE',
        undefined,
        undefined,
        async () => undefined,
      );
    } catch (error) {
      if (!(error instanceof ConnectedBrowserError && error.status === 404)) throw error;
    }
  }
}

interface TabSession {
  session?: RemoteSession;
  creation?: Promise<RemoteSession>;
  navigation?: { key: number; promise: Promise<RemoteSession> };
  controller: AbortController;
  tail: Promise<unknown>;
  pending: number;
  closed: boolean;
}

/** Owns one server context per frontend tab and serializes operations on that context. */
export class RemoteBrowserTabs {
  private readonly tabs = new Map<string, TabSession>();
  private disposed = false;
  constructor(readonly client: ConnectedBrowserClient) {}

  private entry(tabId: string): TabSession {
    if (this.disposed) throw aborted();
    let entry = this.tabs.get(tabId);
    if (!entry) {
      entry = {
        controller: new AbortController(),
        tail: Promise.resolve(),
        pending: 0,
        closed: false,
      };
      this.tabs.set(tabId, entry);
    }
    return entry;
  }

  peek(tabId: string): RemoteSession | undefined {
    return this.tabs.get(tabId)?.session;
  }
  isBusy(tabId: string): boolean {
    const entry = this.tabs.get(tabId);
    return Boolean(entry && (entry.creation || entry.pending));
  }
  hasNavigation(tabId: string, key: number): boolean {
    return this.tabs.get(tabId)?.navigation?.key === key;
  }

  ensure(tabId: string, width = 1280, height = 720): Promise<RemoteSession> {
    const entry = this.entry(tabId);
    if (entry.session) return Promise.resolve(entry.session);
    if (entry.creation) return entry.creation;
    // Do not abort a creation after the server may have allocated an unknown ID. Let its
    // response arrive so close/dispose can immediately DELETE the late-created context.
    const creation = this.client
      .create(width, height)
      .then(async (session) => {
        if (this.disposed || entry.closed || this.tabs.get(tabId) !== entry) {
          await this.client.close(session.id).catch(() => undefined);
          throw aborted();
        }
        entry.session = session;
        return session;
      })
      .finally(() => {
        if (entry.creation === creation) entry.creation = undefined;
      });
    entry.creation = creation;
    return creation;
  }

  private queue<T>(tabId: string, operation: (entry: TabSession) => Promise<T>): Promise<T> {
    const entry = this.entry(tabId);
    if (entry.pending >= 32)
      return Promise.reject(
        new ConnectedBrowserError(
          429,
          'CLIENT_QUEUE_LIMIT',
          'Дождитесь завершения предыдущих действий в странице',
        ),
      );
    entry.pending += 1;
    const result = entry.tail
      .then(() => {
        if (entry.closed || this.disposed) throw aborted();
        return operation(entry);
      })
      .finally(() => {
        entry.pending -= 1;
      });
    entry.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private update(entry: TabSession, session: RemoteSession): RemoteSession {
    if (entry.closed || this.disposed) throw aborted();
    entry.session = session;
    return session;
  }

  navigate(
    tabId: string,
    url: string,
    key: number,
    width = 1280,
    height = 720,
  ): Promise<RemoteSession> {
    const entry = this.entry(tabId);
    if (entry.navigation?.key === key)
      return entry.navigation.promise.then(() => {
        if (entry.closed || this.disposed) throw aborted();
        return entry.session!;
      });
    const promise = this.queue(tabId, async (current) => {
      const session = await this.ensure(tabId, width, height);
      return this.update(
        current,
        await this.client.navigate(session.id, url, current.controller.signal),
      );
    });
    entry.navigation = { key, promise };
    return promise;
  }

  action(tabId: string, action: RemoteAction): Promise<RemoteSession> {
    return this.queue(tabId, async (entry) => {
      const session = await this.ensure(tabId);
      return this.update(
        entry,
        await this.client.action(session.id, action, entry.controller.signal),
      );
    });
  }

  capture(
    tabId: string,
    refreshState: boolean,
    signal?: AbortSignal,
  ): Promise<{ session: RemoteSession; blob: Blob }> {
    return this.queue(tabId, async (entry) => {
      const linked = linkedSignals([entry.controller.signal, signal]);
      try {
        if (linked.signal.aborted) throw aborted();
        let session = await this.ensure(tabId);
        if (refreshState)
          session = this.update(entry, await this.client.state(session.id, linked.signal));
        const blob = await this.client.frame(session.id, linked.signal);
        if (linked.signal.aborted || entry.closed || this.disposed) throw aborted();
        return { session, blob };
      } finally {
        linked.dispose();
      }
    });
  }

  async closeTab(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    this.tabs.delete(tabId);
    entry.closed = true;
    entry.controller.abort(aborted());
    const cleanup: Promise<unknown>[] = [];
    if (entry.session) cleanup.push(this.client.close(entry.session.id));
    if (entry.creation) cleanup.push(entry.creation);
    await Promise.allSettled(cleanup);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled([...this.tabs.keys()].map((id) => this.closeTab(id)));
  }
}
