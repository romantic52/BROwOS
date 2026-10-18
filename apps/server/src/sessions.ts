import { randomBytes } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { ServerConfig } from './config.js';
import { ApiError, asApiError } from './errors.js';
import { startEgressProxy } from './egress-proxy.js';
import { PublicNetworkPolicy } from './network-policy.js';
import type { BrowserAction, SessionService, SessionSnapshot } from './protocol.js';

interface Session {
  id: string;
  owner: string;
  context: BrowserContext;
  page: Page;
  width: number;
  height: number;
  createdAt: number;
  lastActivityAt: number;
  tail: Promise<unknown>;
  pending: number;
  closed: boolean;
}

export interface ChromiumSessionOptions {
  policy?: PublicNetworkPolicy;
  externalProxy?: { url: string; token: string };
  /** Test harness only. There is intentionally no environment flag or production fallback. */
  testOnlyDisableSandbox?: boolean;
  testOnlyExecutablePath?: string;
}

export class ChromiumSessions implements SessionService {
  private readonly sessions = new Map<string, Session>();
  private readonly policy: PublicNetworkPolicy;
  private readonly cleanupTimer: NodeJS.Timeout;
  private browserPromise?: Promise<Browser>;
  private localProxy?: Awaited<ReturnType<typeof startEgressProxy>>;
  private creating = 0;
  private shuttingDown = false;

  constructor(
    private readonly config: ServerConfig,
    private readonly options: ChromiumSessionOptions = {},
  ) {
    if (
      (options.testOnlyDisableSandbox || options.testOnlyExecutablePath) &&
      process.env.NODE_ENV !== 'test'
    ) {
      throw new Error('Browser test overrides are supported only by the test harness.');
    }
    this.policy = options.policy ?? new PublicNetworkPolicy();
    this.cleanupTimer = setInterval(() => void this.cleanup(), 5000);
    this.cleanupTimer.unref();
  }

  private async browser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = (async () => {
        const token = this.options.externalProxy?.token ?? randomBytes(32).toString('hex');
        let proxyUrl = this.options.externalProxy?.url;
        if (!proxyUrl) {
          this.localProxy = await startEgressProxy({ token, policy: this.policy });
          proxyUrl = this.localProxy.url;
        }
        // Do not pass the owner's token or other server environment secrets to Chromium.
        const browserEnvironment: Record<string, string> = {};
        for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_RUNTIME_DIR']) {
          const value = process.env[key];
          if (value) browserEnvironment[key] = value;
        }
        try {
          const browser = await chromium.launch({
            headless: true,
            channel: 'chromium',
            executablePath: this.options.testOnlyExecutablePath,
            chromiumSandbox: !this.options.testOnlyDisableSandbox,
            proxy: { server: proxyUrl, username: 'browos', password: token, bypass: '<-loopback>' },
            env: browserEnvironment,
            args: [
              '--disable-quic',
              '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
              '--disable-features=WebRtcHideLocalIpsWithMdns',
              `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${new URL(proxyUrl).hostname}`,
            ],
          });
          browser.on('disconnected', () => {
            for (const session of this.sessions.values()) session.closed = true;
            this.sessions.clear();
            this.browserPromise = undefined;
            const proxy = this.localProxy;
            this.localProxy = undefined;
            void proxy?.close();
          });
          return browser;
        } catch {
          await this.localProxy?.close();
          this.localProxy = undefined;
          this.browserPromise = undefined;
          throw new ApiError(
            503,
            'BROWSER_UNAVAILABLE',
            'Sandboxed Chromium could not start. Check the browser installation and host sandbox support.',
          );
        }
      })();
    }
    return this.browserPromise;
  }

  async create(
    owner: string,
    dimensions: { width: number; height: number },
  ): Promise<SessionSnapshot> {
    if (this.shuttingDown)
      throw new ApiError(503, 'SHUTTING_DOWN', 'The browser service is stopping.');
    if (this.sessions.size + this.creating >= this.config.maxSessions) {
      throw new ApiError(
        429,
        'SESSION_LIMIT',
        'The concurrent browser session limit has been reached.',
      );
    }
    this.creating += 1;
    let context: BrowserContext | undefined;
    try {
      const browser = await this.browser();
      context = await browser.newContext({
        viewport: dimensions,
        acceptDownloads: false,
        serviceWorkers: 'block',
        permissions: [],
        ignoreHTTPSErrors: false,
      });
      const page = await context.newPage();
      await context.route('**/*', async (route) => {
        const request = route.request();
        try {
          if (request.isNavigationRequest() && request.frame().page() !== page) {
            await route.abort('blockedbyclient');
            return;
          }
          const requestUrl = request.url();
          if (requestUrl !== 'about:blank' && !requestUrl.startsWith('blob:')) {
            this.policy.validateUrl(requestUrl);
          }
          await route.continue();
        } catch {
          await route.abort('blockedbyclient').catch(() => undefined);
        }
      });
      await context.routeWebSocket('**/*', (socket) =>
        socket.close({ code: 1008, reason: 'Not available in this edition' }),
      );
      context.on('page', (child) => {
        if (child !== page) void child.close().catch(() => undefined);
      });
      page.on('popup', (popup) => void popup.close().catch(() => undefined));
      page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
      page.on('download', (download) => void download.cancel().catch(() => undefined));
      page.on('filechooser', (chooser) => void chooser.setFiles([]).catch(() => undefined));
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
      const now = Date.now();
      const session: Session = {
        id: randomBytes(24).toString('base64url'),
        owner,
        context,
        page,
        ...dimensions,
        createdAt: now,
        lastActivityAt: now,
        tail: Promise.resolve(),
        pending: 0,
        closed: false,
      };
      if (this.shuttingDown)
        throw new ApiError(503, 'SHUTTING_DOWN', 'The browser service is stopping.');
      this.sessions.set(session.id, session);
      return await this.snapshot(session);
    } catch (error) {
      await context?.close().catch(() => undefined);
      throw asApiError(error);
    } finally {
      this.creating -= 1;
    }
  }

  private get(owner: string, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.closed || session.owner !== owner) {
      throw new ApiError(
        404,
        'SESSION_NOT_FOUND',
        'This browser session does not exist or has expired.',
      );
    }
    if (this.expired(session)) {
      void this.destroy(session);
      throw new ApiError(
        404,
        'SESSION_EXPIRED',
        'This browser session has expired. Start a new session.',
      );
    }
    return session;
  }

  private async run<T>(
    owner: string,
    id: string,
    action: (session: Session) => Promise<T>,
    touch = true,
  ): Promise<T> {
    const session = this.get(owner, id);
    if (session.pending >= 8)
      throw new ApiError(429, 'SESSION_BUSY', 'Too many pending browser operations.');
    session.pending += 1;
    if (touch) session.lastActivityAt = Date.now();
    const result = session.tail
      .catch(() => undefined)
      .then(async () => {
        if (session.closed)
          throw new ApiError(404, 'SESSION_NOT_FOUND', 'This browser session has closed.');
        return action(session);
      });
    session.tail = result;
    try {
      return await result;
    } catch (error) {
      throw asApiError(error);
    } finally {
      session.pending -= 1;
    }
  }

  private async snapshot(session: Session): Promise<SessionSnapshot> {
    const url = session.page.url();
    if (url !== 'about:blank') {
      try {
        // Redirects can return a proxy-generated 403 document instead of making
        // page.goto throw. Never report a prohibited final URL as a successful visit.
        this.policy.validateUrl(url);
      } catch (error) {
        await session.page.goto('about:blank').catch(() => undefined);
        throw error;
      }
    }
    return {
      id: session.id,
      url,
      title: (await session.page.title().catch(() => '')).slice(0, 512),
      width: session.width,
      height: session.height,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivityAt: new Date(session.lastActivityAt).toISOString(),
    };
  }

  read(owner: string, id: string): Promise<SessionSnapshot> {
    return this.run(owner, id, (session) => this.snapshot(session), false);
  }

  async navigate(owner: string, id: string, input: string): Promise<SessionSnapshot> {
    const url = this.policy.validateUrl(input);
    return this.run(owner, id, async (session) => {
      await session.page.goto(url.href, { waitUntil: 'domcontentloaded' });
      return this.snapshot(session);
    });
  }

  action(owner: string, id: string, action: BrowserAction): Promise<SessionSnapshot> {
    return this.run(owner, id, async (session) => {
      const page = session.page;
      if (
        (action.type === 'click' || action.type === 'move') &&
        (action.x >= session.width || action.y >= session.height)
      ) {
        throw new ApiError(
          400,
          'INVALID_COORDINATES',
          'Pointer coordinates must be inside the viewport.',
        );
      }
      switch (action.type) {
        case 'click':
          await page.mouse.click(action.x, action.y, {
            button: action.button,
            clickCount: action.clickCount,
          });
          break;
        case 'move':
          await page.mouse.move(action.x, action.y);
          break;
        case 'wheel':
          await page.mouse.wheel(action.deltaX, action.deltaY);
          break;
        case 'key':
          await page.keyboard.press(action.key);
          break;
        case 'text':
          await page.keyboard.insertText(action.text);
          break;
        case 'back':
          await page.goBack({ waitUntil: 'domcontentloaded' });
          break;
        case 'forward':
          await page.goForward({ waitUntil: 'domcontentloaded' });
          break;
        case 'reload':
          await page.reload({ waitUntil: 'domcontentloaded' });
          break;
        case 'resize':
          await page.setViewportSize({ width: action.width, height: action.height });
          session.width = action.width;
          session.height = action.height;
          break;
      }
      return this.snapshot(session);
    });
  }

  frame(owner: string, id: string): Promise<Buffer> {
    return this.run(
      owner,
      id,
      (session) => session.page.screenshot({ type: 'jpeg', quality: 65, timeout: 5000 }),
      false,
    );
  }

  async remove(owner: string, id: string): Promise<void> {
    await this.destroy(this.get(owner, id));
  }

  private expired(session: Session): boolean {
    const now = Date.now();
    return (
      now - session.lastActivityAt > this.config.idleTimeoutMs ||
      now - session.createdAt > this.config.maxSessionLifetimeMs
    );
  }

  private async destroy(session: Session): Promise<void> {
    session.closed = true;
    this.sessions.delete(session.id);
    await session.context.close().catch(() => undefined);
  }

  private async cleanup(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (this.expired(session)) await this.destroy(session);
    }
  }

  async close(): Promise<void> {
    this.shuttingDown = true;
    clearInterval(this.cleanupTimer);
    await Promise.allSettled([...this.sessions.values()].map((session) => this.destroy(session)));
    const browser = await this.browserPromise?.catch(() => undefined);
    const proxy = this.localProxy;
    this.localProxy = undefined;
    await browser?.close().catch(() => undefined);
    await proxy?.close();
  }
}
