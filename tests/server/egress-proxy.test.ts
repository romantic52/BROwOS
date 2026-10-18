import { createServer, request, type Server } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startEgressProxy } from '../../apps/server/src/egress-proxy.js';
import { PublicNetworkPolicy } from '../../apps/server/src/network-policy.js';

const token = 'separate-test-proxy-token-with-over-32-characters';
const proxyAuth = `Basic ${Buffer.from(`browos:${token}`).toString('base64')}`;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return address.port;
}

function viaProxy(
  proxyPort: number,
  url: string,
  authenticate = true,
  extra: Record<string, string> = {},
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: proxyPort,
        path: url,
        method: 'GET',
        headers: { ...(authenticate ? { 'Proxy-Authorization': proxyAuth } : {}), ...extra },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          data += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function connectResponse(proxyPort: number, authority: string, authenticate: boolean) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(proxyPort, '127.0.0.1', () => {
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${authenticate ? `Proxy-Authorization: ${proxyAuth}\r\n` : ''}\r\n`,
      );
    });
    let response = '';
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString();
    });
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
  });
}

describe('authenticated DNS-pinning egress proxy transport', () => {
  it('connects to the pinned fixture IP while preserving the original Host header', async () => {
    let headers: Record<string, string | string[] | undefined> = {};
    const port = await listen(
      createServer((request, response) => {
        headers = request.headers;
        response.end('pinned-target-reached');
      }),
    );
    const proxy = await startEgressProxy({
      token,
      policy: new PublicNetworkPolicy({ testOnlyLoopbackPort: port }),
    });
    cleanups.push(() => proxy.close());
    // This .invalid hostname has no DNS entry. Success proves the socket used the
    // policy's numeric IP instead of resolving the original hostname a second time.
    const response = await viaProxy(
      proxy.port,
      `http://browos-fixture.invalid:${port}/fixture`,
      true,
      { Host: 'metadata.google.internal' },
    );
    expect(response).toEqual({ status: 200, body: 'pinned-target-reached' });
    expect(headers.host).toBe(`browos-fixture.invalid:${port}`);
    expect(headers['proxy-authorization']).toBeUndefined();
  });

  it('requires a separate proxy credential and blocks private HTTP targets', async () => {
    const proxy = await startEgressProxy({ token });
    cleanups.push(() => proxy.close());
    expect((await viaProxy(proxy.port, 'http://example.com/', false)).status).toBe(407);
    expect((await viaProxy(proxy.port, 'http://169.254.169.254/latest/meta-data/')).status).toBe(
      403,
    );
    expect((await viaProxy(proxy.port, 'http://127.0.0.1/')).status).toBe(403);
  });

  it('checks authentication, port and public-address policy for HTTPS CONNECT tunnels', async () => {
    const proxy = await startEgressProxy({ token });
    cleanups.push(() => proxy.close());
    expect(await connectResponse(proxy.port, 'example.com:443', false)).toContain(
      '407 Proxy Authentication Required',
    );
    expect(await connectResponse(proxy.port, '169.254.169.254:443', true)).toContain(
      '403 Forbidden',
    );
    expect(await connectResponse(proxy.port, '[::ffff:127.0.0.1]:443', true)).toContain(
      '403 Forbidden',
    );
    expect(await connectResponse(proxy.port, 'example.com:22', true)).toContain('403 Forbidden');
  });
});
