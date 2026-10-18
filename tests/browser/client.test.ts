import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectedBrowserClient,
  ConnectedBrowserError,
  RemoteBrowserTabs,
  remoteViewport,
  type RemoteSession,
} from '../../system-apps/browser/src/client';

const TOKEN = 'test-token-with-at-least-thirty-two-characters';
const SESSION_ID = 'a'.repeat(32);
const pools: RemoteBrowserTabs[] = [];

function snapshot(patch: Partial<RemoteSession> = {}): RemoteSession {
  return {
    id: SESSION_ID,
    url: 'about:blank',
    title: '',
    width: 1280,
    height: 720,
    createdAt: '2026-10-18T00:00:00.000Z',
    lastActivityAt: '2026-10-18T00:00:00.000Z',
    ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function client() {
  return new ConnectedBrowserClient('https://chromium.example.test', TOKEN);
}
function fakeTransport() {
  const transport = client();
  const create = vi.spyOn(transport, 'create').mockResolvedValue(snapshot());
  const navigate = vi
    .spyOn(transport, 'navigate')
    .mockImplementation(async (_id, url) => snapshot({ url, title: 'Loaded page' }));
  const action = vi
    .spyOn(transport, 'action')
    .mockResolvedValue(snapshot({ url: 'https://example.com/', title: 'Page' }));
  const state = vi
    .spyOn(transport, 'state')
    .mockResolvedValue(snapshot({ url: 'https://example.com/', title: 'Page' }));
  const frame = vi
    .spyOn(transport, 'frame')
    .mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  const close = vi.spyOn(transport, 'close').mockResolvedValue();
  const pool = new RemoteBrowserTabs(transport);
  pools.push(pool);
  return { transport, pool, create, navigate, action, state, frame, close };
}

afterEach(async () => {
  await Promise.allSettled(pools.splice(0).map((pool) => pool.dispose()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Connected HTTP client', () => {
  it.each([
    ['https://chromium.example.test/', 'https://chromium.example.test'],
    ['https://chromium.example.test/browos///', 'https://chromium.example.test/browos'],
    ['http://localhost:3001', 'http://localhost:3001'],
    ['http://127.0.0.1:3001/', 'http://127.0.0.1:3001'],
    ['http://[::1]:3001/', 'http://[::1]:3001'],
  ])('accepts a configured secure or loopback API endpoint: %s', (endpoint, expected) =>
    expect(new ConnectedBrowserClient(endpoint, TOKEN).endpoint).toBe(expected),
  );

  it.each([
    'http://public.example.com',
    'ftp://example.com',
    'javascript:alert(1)',
    'https://user:password@example.com',
    'https://example.com?token=private',
    'https://example.com#secret',
  ])('rejects unsafe API endpoints: %s', (endpoint) =>
    expect(() => new ConnectedBrowserClient(endpoint, TOKEN)).toThrow(),
  );

  it('rejects tokens that the server configuration would reject', () => {
    for (const token of ['short', 'a'.repeat(257), `${'a'.repeat(32)}\n`, `${'a'.repeat(32)} x`])
      expect(() => new ConnectedBrowserClient('https://example.com', token)).toThrow();
  });

  it('authenticates via a Bearer header without cookies, redirects or URL tokens, and matches ISO timestamps', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(snapshot()), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await client().create(280.5, 1200);
    expect(result.createdAt).toBe('2026-10-18T00:00:00.000Z');
    const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chromium.example.test/api/sessions');
    expect(url).not.toContain(TOKEN);
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(options.body as string)).toEqual({ width: 320, height: 1080 });
  });

  it('uses the actual metadata and action endpoints and reads JPEG frames as blobs', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith('/frame')
        ? new Response('jpeg bytes', { headers: { 'Content-Type': 'image/jpeg' } })
        : new Response(JSON.stringify(snapshot()), {
            headers: { 'Content-Type': 'application/json' },
          }),
    );
    vi.stubGlobal('fetch', fetch);
    const transport = client();
    await transport.state(SESSION_ID);
    await transport.action(SESSION_ID, { type: 'resize', width: 640, height: 480 });
    expect((await transport.frame(SESSION_ID)).type).toBe('image/jpeg');
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      `https://chromium.example.test/api/sessions/${SESSION_ID}`,
      `https://chromium.example.test/api/sessions/${SESSION_ID}/action`,
      `https://chromium.example.test/api/sessions/${SESSION_ID}/frame`,
    ]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      type: 'resize',
      width: 640,
      height: 480,
    });
  });

  it('exposes structured server errors and rate-limit retry times without depending on an HTML error body', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'SESSION_LIMIT', message: 'Four sessions are already open.' },
          }),
          { status: 429, headers: { 'Retry-After': '15' } },
        ),
      )
      .mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    await expect(client().create()).rejects.toMatchObject({
      status: 429,
      code: 'SESSION_LIMIT',
      message: 'Four sessions are already open.',
      retryAfterMs: 15_000,
    });
    await expect(client().create()).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      message: 'Сервер ответил 502',
    });
    await expect(client().create()).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 });
  });

  it('treats deletion of expired sessions as successful cleanup but still reports authentication failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 404 }))
        .mockResolvedValueOnce(new Response('{}', { status: 401 })),
    );
    await expect(client().close(SESSION_ID)).resolves.toBeUndefined();
    await expect(client().close(SESSION_ID)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects malformed snapshots instead of passing unsafe URLs and geometry into the UI', async () => {
    const invalid = [
      { ...snapshot(), url: 'javascript:alert(1)' },
      { ...snapshot(), url: 'https://user:secret@example.com' },
      { ...snapshot(), width: -1 },
      { ...snapshot(), height: 480.5 },
      { ...snapshot(), id: '../other' },
      { ...snapshot(), createdAt: 1000 },
      { ...snapshot(), lastActivityAt: 'not a date' },
    ];
    const fetch = vi.fn();
    for (const item of invalid) fetch.mockResolvedValueOnce(new Response(JSON.stringify(item)));
    fetch.mockResolvedValueOnce(new Response('{broken'));
    vi.stubGlobal('fetch', fetch);
    for (let index = 0; index < invalid.length + 1; index += 1)
      await expect(client().create()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a non-JPEG frame and aborts active HTTP work when its owner disconnects', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }));
    fetch.mockImplementationOnce(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(client().frame(SESSION_ID)).rejects.toMatchObject({ code: 'INVALID_FRAME' });
    const controller = new AbortController();
    const frame = client().frame(SESSION_ID, controller.signal);
    const result = expect(frame).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(new DOMException('Disconnected', 'AbortError'));
    await result;
  });

  it('bounds request lifetime when the API does not respond', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
              once: true,
            });
          }),
      ),
    );
    const pending = client().state(SESSION_ID);
    const failed = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(35_000);
    await failed;
  });

  it('rounds and clamps measured surface sizes to the real server viewport limits', () => {
    expect(remoteViewport(800.8, 500.1)).toEqual({ width: 801, height: 500 });
    expect(remoteViewport(0, 0)).toEqual({ width: 320, height: 240 });
    expect(remoteViewport(5000, 5000)).toEqual({ width: 1920, height: 1080 });
    expect(remoteViewport(NaN, Infinity)).toEqual({ width: 1280, height: 720 });
  });
});

describe('remote tab ownership and lifecycle', () => {
  it('deduplicates concurrent creation from connect, navigation and frame polling', async () => {
    const api = fakeTransport();
    const creation = deferred<RemoteSession>();
    api.create.mockReturnValueOnce(creation.promise);
    const connected = api.pool.ensure('tab');
    const navigated = api.pool.navigate('tab', 'https://example.com/', 1);
    const frame = api.pool.capture('tab', true);
    creation.resolve(snapshot());
    await Promise.all([connected, navigated, frame]);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.navigate).toHaveBeenCalledTimes(1);
    expect(api.state).toHaveBeenCalledTimes(1);
    expect(api.frame).toHaveBeenCalledTimes(1);
  });

  it('does not re-navigate an existing tab just because its polling effect restarts', async () => {
    const api = fakeTransport();
    await Promise.all([
      api.pool.navigate('tab', 'https://example.com/', 1),
      api.pool.navigate('tab', 'https://example.com/', 1),
    ]);
    api.state.mockResolvedValue(
      snapshot({ url: 'https://example.com/followed-link', title: 'Link destination' }),
    );
    await api.pool.capture('tab', true);
    const latest = await api.pool.navigate('tab', 'https://example.com/followed-link', 1);
    expect(latest.url).toBe('https://example.com/followed-link');
    expect(api.navigate).toHaveBeenCalledTimes(1);
    await api.pool.navigate('tab', 'https://example.com/typed-url', 2);
    expect(api.navigate).toHaveBeenCalledTimes(2);
  });

  it('serializes input actions so earlier text is not overtaken by later keys', async () => {
    const api = fakeTransport();
    await api.pool.ensure('tab');
    const first = deferred<RemoteSession>();
    api.action.mockReturnValueOnce(first.promise);
    const entered = api.pool.action('tab', { type: 'text', text: 'search words' });
    const submitted = api.pool.action('tab', { type: 'key', key: 'Enter' });
    await vi.waitFor(() => expect(api.action).toHaveBeenCalledTimes(1));
    expect(api.pool.isBusy('tab')).toBe(true);
    first.resolve(snapshot());
    await Promise.all([entered, submitted]);
    expect(api.action.mock.calls.map((call) => call[1])).toEqual([
      { type: 'text', text: 'search words' },
      { type: 'key', key: 'Enter' },
    ]);
    expect(api.pool.isBusy('tab')).toBe(false);
  });

  it('deletes a session that finishes creation after its frontend tab was closed', async () => {
    const api = fakeTransport();
    const creation = deferred<RemoteSession>();
    api.create.mockReturnValueOnce(creation.promise);
    const pending = api.pool.ensure('closed-tab');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const closing = api.pool.closeTab('closed-tab');
    creation.resolve(snapshot());
    await Promise.all([rejected, closing]);
    expect(api.close).toHaveBeenCalledExactlyOnceWith(SESSION_ID);
    expect(api.pool.peek('closed-tab')).toBeUndefined();
  });

  it('aborts active frame reads and cleans both known and late-created sessions on disconnect', async () => {
    const api = fakeTransport();
    await api.pool.ensure('open');
    const late = deferred<RemoteSession>();
    api.create.mockReturnValueOnce(late.promise);
    const creating = api.pool.ensure('creating');
    const createRejected = expect(creating).rejects.toMatchObject({ name: 'AbortError' });
    const frameStarted = deferred<void>();
    api.frame.mockImplementationOnce(
      (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
          frameStarted.resolve();
        }),
    );
    const capturing = api.pool.capture('open', false);
    const frameRejected = expect(capturing).rejects.toMatchObject({ name: 'AbortError' });
    await frameStarted.promise;
    const disposing = api.pool.dispose();
    late.resolve(snapshot({ id: 'b'.repeat(32) }));
    await Promise.all([disposing, createRejected, frameRejected]);
    expect(api.close.mock.calls.map((call) => call[0]).sort()).toEqual([
      SESSION_ID,
      'b'.repeat(32),
    ]);
    expect(() => api.pool.ensure('new')).toThrow(DOMException);
  });

  it('does not resurrect a closed tab when an already-sent navigation completes late', async () => {
    const api = fakeTransport();
    await api.pool.ensure('tab');
    const navigation = deferred<RemoteSession>();
    api.navigate.mockReturnValueOnce(navigation.promise);
    const pending = api.pool.navigate('tab', 'https://example.com/', 1);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(api.navigate).toHaveBeenCalledTimes(1));
    await api.pool.closeTab('tab');
    navigation.resolve(snapshot({ url: 'https://example.com/' }));
    await rejected;
    expect(api.pool.peek('tab')).toBeUndefined();
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it('allows an explicit retry after failed creation or failed navigation', async () => {
    const api = fakeTransport();
    api.create.mockRejectedValueOnce(
      new ConnectedBrowserError(503, 'BROWSER_UNAVAILABLE', 'Unavailable'),
    );
    await expect(api.pool.ensure('tab')).rejects.toMatchObject({ status: 503 });
    await expect(api.pool.ensure('tab')).resolves.toMatchObject({ id: SESSION_ID });
    api.navigate.mockRejectedValueOnce(new Error('Temporary navigation failure'));
    await expect(api.pool.navigate('tab', 'https://example.com/', 1)).rejects.toThrow('Temporary');
    await expect(api.pool.navigate('tab', 'https://example.com/', 2)).resolves.toMatchObject({
      url: 'https://example.com/',
    });
    expect(api.create).toHaveBeenCalledTimes(2);
  });

  it('refreshes actual link navigation, title and viewport metadata alongside authenticated frames', async () => {
    const api = fakeTransport();
    await api.pool.ensure('tab');
    api.state.mockResolvedValue(
      snapshot({
        url: 'https://example.com/next',
        title: 'After a link click',
        width: 640,
        height: 480,
      }),
    );
    const captured = await api.pool.capture('tab', true);
    expect(captured.session).toMatchObject({
      url: 'https://example.com/next',
      title: 'After a link click',
      width: 640,
      height: 480,
    });
    expect(captured.blob.type).toBe('image/jpeg');
    expect(api.pool.peek('tab')).toEqual(captured.session);
  });

  it('cancels an old tab frame without disposing the tab when switching views', async () => {
    const api = fakeTransport();
    await api.pool.ensure('tab');
    const started = deferred<void>();
    api.frame.mockImplementationOnce(
      (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
          started.resolve();
        }),
    );
    const controller = new AbortController();
    const pending = api.pool.capture('tab', false, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    controller.abort(new DOMException('Switched tab', 'AbortError'));
    await rejected;
    expect(api.pool.peek('tab')?.id).toBe(SESSION_ID);
    expect(api.close).not.toHaveBeenCalled();
    await expect(api.pool.capture('tab', false)).resolves.toHaveProperty('blob');
  });
});
