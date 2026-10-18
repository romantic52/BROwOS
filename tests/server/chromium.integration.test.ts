import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChromiumSessions } from '../../apps/server/src/sessions.js';
import { PublicNetworkPolicy } from '../../apps/server/src/network-policy.js';
import { readConfig } from '../../apps/server/src/config.js';

const run = process.env.BROWOS_TEST_CHROMIUM === '1';

describe.skipIf(!run)('real Connected Chromium integration (explicit browser-install gate)', () => {
  let sessions: ChromiumSessions;
  let fixture: Server;
  let privateTrap: Server;
  let url: string;
  let trapRequests = 0;

  async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing integration fixture port');
    return address.port;
  }

  beforeAll(async () => {
    privateTrap = createServer((_request, response) => {
      trapRequests += 1;
      response.end('private data');
    });
    const trapPort = await listen(privateTrap);
    fixture = createServer((request, response) => {
      if (request.url === '/redirect-private') {
        response.writeHead(302, { Location: `http://127.0.0.1:${trapPort}/private` });
        response.end();
      } else if (request.url === '/cookie') {
        response.writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': 'browos=owner; SameSite=Lax',
        });
        response.end('<title>cookie set</title>');
      } else if (request.url === '/state') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          `<title>${request.headers.cookie?.includes('browos=owner') ? 'has cookie' : 'isolated'}</title>`,
        );
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          `<!doctype html><html><head><title>BROwOS fixture</title></head><body style="margin:0;background:#e8eff8;height:1800px"><input id="name" style="position:absolute;left:20px;top:20px;width:280px;height:40px"><button style="position:absolute;left:20px;top:80px;width:200px;height:40px" onclick="document.title='Hello '+document.getElementById('name').value">Apply title</button><h1 style="position:absolute;top:140px">Real Chromium fixture</h1></body></html>`,
        );
      }
    });
    const port = await listen(fixture);
    url = `http://browos-fixture.invalid:${port}`;
    sessions = new ChromiumSessions(
      {
        ...readConfig({
          BROWOS_ACCESS_TOKEN: 'integration-test-owner-token-at-least-32-characters',
        }),
        maxSessions: 2,
        idleTimeoutMs: 60_000,
      },
      {
        policy: new PublicNetworkPolicy({ testOnlyLoopbackPort: port }),
        testOnlyDisableSandbox: process.env.BROWOS_TEST_DISABLE_SANDBOX === '1',
        testOnlyExecutablePath: process.env.BROWOS_TEST_BROWSER_PATH,
      },
    );
  });

  afterAll(async () => {
    await sessions?.close();
    for (const server of [fixture, privateTrap]) {
      if (!server) continue;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('navigates a real page, renders JPEG, applies pointer/text/key/wheel/resize and deletes state', async () => {
    const session = await sessions.create('owner', { width: 800, height: 600 });
    try {
      expect(await sessions.navigate('owner', session.id, url)).toMatchObject({
        title: 'BROwOS fixture',
      });
      await sessions.action('owner', session.id, { type: 'click', x: 50, y: 40 });
      await sessions.action('owner', session.id, { type: 'text', text: 'BROwOS' });
      await sessions.action('owner', session.id, { type: 'key', key: 'Tab' });
      await sessions.action('owner', session.id, { type: 'key', key: 'Enter' });
      expect(await sessions.read('owner', session.id)).toMatchObject({ title: 'Hello BROwOS' });
      const image = await sessions.frame('owner', session.id);
      expect(image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(image.length).toBeGreaterThan(2000);
      await sessions.action('owner', session.id, { type: 'wheel', deltaX: 0, deltaY: 250 });
      expect(
        await sessions.action('owner', session.id, { type: 'resize', width: 640, height: 480 }),
      ).toMatchObject({ width: 640, height: 480 });
      await expect(sessions.read('another-owner', session.id)).rejects.toMatchObject({
        status: 404,
      });
    } finally {
      await sessions.remove('owner', session.id);
    }
    await expect(sessions.read('owner', session.id)).rejects.toMatchObject({ status: 404 });
  }, 30_000);

  it('isolates cookie state per context and enforces the concurrent session limit', async () => {
    const a = await sessions.create('owner', { width: 800, height: 600 });
    const b = await sessions.create('owner', { width: 800, height: 600 });
    try {
      await sessions.navigate('owner', a.id, `${url}/cookie`);
      expect(await sessions.navigate('owner', a.id, `${url}/state`)).toMatchObject({
        title: 'has cookie',
      });
      expect(await sessions.navigate('owner', b.id, `${url}/state`)).toMatchObject({
        title: 'isolated',
      });
      await expect(sessions.create('owner', { width: 800, height: 600 })).rejects.toMatchObject({
        code: 'SESSION_LIMIT',
      });
      await sessions.action('owner', a.id, { type: 'back' });
      expect(await sessions.read('owner', a.id)).toMatchObject({ title: 'cookie set' });
      await sessions.action('owner', a.id, { type: 'forward' });
      expect(await sessions.read('owner', a.id)).toMatchObject({ title: 'has cookie' });
    } finally {
      await sessions.remove('owner', a.id);
      await sessions.remove('owner', b.id);
    }
  }, 30_000);

  it('blocks a redirect into a private endpoint before that endpoint receives a request', async () => {
    const session = await sessions.create('owner', { width: 800, height: 600 });
    try {
      await expect(
        sessions.navigate('owner', session.id, `${url}/redirect-private`),
      ).rejects.toBeDefined();
      await expect(
        sessions.navigate('owner', session.id, 'http://169.254.169.254/'),
      ).rejects.toMatchObject({ code: 'URL_BLOCKED' });
      expect(trapRequests).toBe(0);
    } finally {
      await sessions.remove('owner', session.id);
    }
  }, 30_000);
});
