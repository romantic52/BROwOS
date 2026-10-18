import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { matchesSecret, secretDigest } from './auth.js';
import { PublicNetworkPolicy } from './network-policy.js';

export interface EgressProxyOptions {
  token: string;
  host?: string;
  port?: number;
  policy?: PublicNetworkPolicy;
  maxConnections?: number;
  maxTransferBytes?: number;
}

function stripHopHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result = { ...headers };
  const nominated = (headers.connection ?? '')
    .toLowerCase()
    .split(',')
    .map((item) => item.trim());
  for (const key of [
    ...nominated,
    'connection',
    'proxy-connection',
    'proxy-authorization',
    'proxy-authenticate',
    'keep-alive',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
  ])
    delete result[key];
  return result;
}

export async function startEgressProxy(options: EgressProxyOptions) {
  if (options.token.length < 32 || options.token.length > 256 || /\s/.test(options.token))
    throw new Error('The egress proxy requires a 32–256 character non-whitespace credential.');
  const policy = options.policy ?? new PublicNetworkPolicy();
  const credential = secretDigest(`browos:${options.token}`);
  const sockets = new Set<Socket>();
  const active = new Set<Duplex | IncomingMessage>();
  const maximum = options.maxConnections ?? 128;
  const transferLimit = options.maxTransferBytes ?? 64 * 1024 * 1024;

  function authenticated(request: IncomingMessage): boolean {
    const header = request.headers['proxy-authorization'];
    if (typeof header !== 'string' || !/^Basic [A-Za-z0-9+/=]{1,512}$/.test(header)) return false;
    return matchesSecret(Buffer.from(header.slice(6), 'base64').toString('utf8'), credential);
  }

  function rejectHttp(response: ServerResponse, status: number) {
    if (status === 407) response.setHeader('Proxy-Authenticate', 'Basic realm="BROwOS egress"');
    response.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end(
      status === 407 ? 'Proxy authentication required' : 'Destination unavailable or blocked',
    );
  }

  const server = createServer(async (incoming, response) => {
    if (!authenticated(incoming)) return rejectHttp(response, 407);
    if (active.size >= maximum) return rejectHttp(response, 503);
    if (
      !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(incoming.method ?? '')
    ) {
      return rejectHttp(response, 405);
    }
    // Reserve capacity before DNS awaits, preventing concurrent requests bypassing the cap.
    active.add(incoming);
    response.once('close', () => active.delete(incoming));
    try {
      const target = await policy.resolveTarget(incoming.url ?? '');
      if (target.url.protocol !== 'http:') return rejectHttp(response, 400);
      const headers = stripHopHeaders(incoming.headers);
      headers.host = target.url.host;
      const outbound = httpRequest({
        hostname: target.address, // Validated literal IP: no second DNS lookup/rebinding window.
        family: target.family,
        port: target.port,
        path: target.url.pathname + target.url.search,
        method: incoming.method,
        headers,
        agent: false,
        timeout: 15_000,
      });
      let uploaded = 0;
      incoming.on('data', (chunk: Buffer) => {
        uploaded += chunk.length;
        if (uploaded > transferLimit) outbound.destroy(new Error('Transfer cap reached'));
      });
      outbound.on('response', (upstream) => {
        response.writeHead(upstream.statusCode ?? 502, stripHopHeaders(upstream.headers));
        let received = 0;
        upstream.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > transferLimit) {
            upstream.destroy();
            response.destroy();
          }
        });
        upstream.on('error', () => response.destroy());
        upstream.pipe(response);
      });
      outbound.on('timeout', () => outbound.destroy(new Error('Upstream timeout')));
      outbound.on('error', () => {
        if (!response.headersSent) rejectHttp(response, 502);
        else response.destroy();
      });
      incoming.on('aborted', () => outbound.destroy());
      response.on('close', () => {
        outbound.destroy();
        active.delete(incoming);
      });
      incoming.pipe(outbound);
    } catch {
      rejectHttp(response, 403);
    } finally {
      if (response.writableEnded) active.delete(incoming);
    }
  });

  server.on('connect', async (request, client, head) => {
    const deny = (status: number) => {
      client.end(
        `HTTP/1.1 ${status} ${status === 407 ? 'Proxy Authentication Required' : 'Forbidden'}\r\n` +
          (status === 407 ? 'Proxy-Authenticate: Basic realm="BROwOS egress"\r\n' : '') +
          'Connection: close\r\nContent-Length: 0\r\n\r\n',
      );
    };
    if (!authenticated(request)) return deny(407);
    if (active.size >= maximum) return deny(503);
    active.add(client);
    client.once('close', () => active.delete(client));
    try {
      const authority = request.url ?? '';
      if (!/^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):443$/.test(authority)) return deny(403);
      const target = await policy.resolveTarget(`https://${authority}/`);
      if (client.destroyed) return;
      const upstream = connect({ host: target.address, family: target.family, port: target.port });
      sockets.add(upstream);
      upstream.once('close', () => sockets.delete(upstream));
      upstream.setTimeout(60_000, () => upstream.destroy());
      let bytes = head.length;
      const cap = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > transferLimit) {
          upstream.destroy();
          client.destroy();
        }
      };
      client.on('data', cap);
      upstream.on('data', cap);
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
      client.on('close', () => upstream.destroy());
    } catch {
      deny(403);
    }
  });
  server.on('upgrade', (_request, socket) =>
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'),
  );
  server.on('connection', (socket) => {
    if (sockets.size >= maximum * 2) return socket.destroy();
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(60_000, () => socket.destroy());
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('The proxy did not bind a TCP port.');
  return {
    url: `http://${options.host ?? '127.0.0.1'}:${address.port}`,
    port: address.port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
