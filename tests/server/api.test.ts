import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiServer } from '../../apps/server/src/api.js';
import { readConfig } from '../../apps/server/src/config.js';
import { ownerId } from '../../apps/server/src/auth.js';
import type { SessionService, SessionSnapshot } from '../../apps/server/src/protocol.js';

const token = 'browos-test-only-access-token-with-over-32-characters';
const id = 'a'.repeat(32);
const snapshot: SessionSnapshot = {
  id,
  url: 'about:blank',
  title: '',
  width: 1280,
  height: 720,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function start(requestsPerMinute = 600) {
  const sessions: SessionService = {
    create: vi.fn(async () => snapshot),
    read: vi.fn(async () => snapshot),
    navigate: vi.fn(async () => snapshot),
    action: vi.fn(async () => snapshot),
    frame: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    remove: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const config = { ...readConfig({ BROWOS_ACCESS_TOKEN: token }), requestsPerMinute };
  const server = createApiServer(config, sessions);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing API fixture port');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const url = `http://127.0.0.1:${address.port}`;
  const auth = { Authorization: `Bearer ${token}` };
  return { url, auth, sessions };
}

describe('authenticated browser HTTP API', () => {
  it('exposes minimal health without opening a browser; protects every session route', async () => {
    const { url, sessions } = await start();
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect(sessions.create).not.toHaveBeenCalled();
    const response = await fetch(`${url}/api/sessions`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    expect(await response.text()).not.toContain(token);
    expect((await fetch(`${url}/api/sessions/${id}?token=${token}`)).status).toBe(401);
  });

  it('creates a session owned by the authenticated credential and returns no secret', async () => {
    const { url, auth, sessions } = await start();
    const response = await fetch(`${url}/api/sessions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 800, height: 600 }),
    });
    expect(response.status).toBe(201);
    expect(sessions.create).toHaveBeenCalledWith(ownerId(token), { width: 800, height: 600 });
    expect(await response.json()).toEqual(snapshot);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('uses an exact CORS allowlist and rejects null and deceptive origins', async () => {
    const { url, auth } = await start();
    for (const origin of ['null', 'https://evil.example', 'http://localhost:5173.evil.example']) {
      const response = await fetch(`${url}/api/sessions/${id}`, {
        headers: { ...auth, Origin: origin },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    const response = await fetch(`${url}/api/sessions/${id}`, {
      headers: { ...auth, Origin: 'http://localhost:5173' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('allows the required authenticated-fetch preflight and rejects extra headers', async () => {
    const { url } = await start();
    const headers = {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    };
    expect((await fetch(`${url}/api/sessions`, { method: 'OPTIONS', headers })).status).toBe(204);
    expect(
      (
        await fetch(`${url}/api/sessions`, {
          method: 'OPTIONS',
          headers: { ...headers, 'Access-Control-Request-Headers': 'x-bypass' },
        })
      ).status,
    ).toBe(403);
  });

  it('rejects malformed JSON, oversized bodies and unsupported actions before browser execution', async () => {
    const { url, auth, sessions } = await start();
    const headers = { ...auth, 'Content-Type': 'application/json' };
    expect(
      (await fetch(`${url}/api/sessions`, { method: 'POST', headers, body: '{broken' })).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${url}/api/sessions`, {
          method: 'POST',
          headers,
          body: '"' + 'a'.repeat(20_000) + '"',
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await fetch(`${url}/api/sessions/${id}/action`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ type: 'evaluate', script: 'alert(1)' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await fetch(`${url}/api/sessions`, { method: 'POST', headers: auth, body: '{}' })).status,
    ).toBe(415);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(sessions.action).not.toHaveBeenCalled();
  });

  it('serves authenticated JPEG frames, forwards actions and deletes sessions', async () => {
    const { url, auth, sessions } = await start();
    const frame = await fetch(`${url}/api/sessions/${id}/frame`, { headers: auth });
    expect(frame.status).toBe(200);
    expect(frame.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await frame.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    );
    const action = { type: 'text', text: 'Hello BROwOS' };
    expect(
      (
        await fetch(`${url}/api/sessions/${id}/action`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
        })
      ).status,
    ).toBe(200);
    expect(sessions.action).toHaveBeenCalledWith(ownerId(token), id, action);
    expect(
      (await fetch(`${url}/api/sessions/${id}`, { method: 'DELETE', headers: auth })).status,
    ).toBe(204);
    expect(sessions.remove).toHaveBeenCalledWith(ownerId(token), id);
  });

  it('caps requests and repeated failed authentication independently', async () => {
    const { url } = await start(2);
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/health`)).status).toBe(200);
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    const second = await start();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await fetch(`${second.url}/api/sessions/${id}`)).status).toBe(401);
    }
    expect((await fetch(`${second.url}/api/sessions/${id}`)).status).toBe(429);
  });

  it('does not return raw browser errors or internal secrets', async () => {
    const { url, auth, sessions } = await start();
    vi.mocked(sessions.read).mockRejectedValueOnce(
      new Error(`Internal process environment: ${token}`),
    );
    const response = await fetch(`${url}/api/sessions/${id}`, { headers: auth });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain('BROWSER_ERROR');
    expect(text).not.toContain(token);
    expect(text).not.toContain('Internal process environment');
  });
});
