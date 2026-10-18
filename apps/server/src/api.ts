import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { matchesSecret, ownerId, readBearer, secretDigest } from './auth.js';
import type { ServerConfig } from './config.js';
import { ApiError, asApiError } from './errors.js';
import {
  objectBody,
  parseAction,
  parseNavigate,
  viewport,
  type SessionService,
} from './protocol.js';

class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= 4096) {
        for (const [id, item] of this.buckets) {
          if (item.resetAt <= now) this.buckets.delete(id);
        }
        if (this.buckets.size >= 4096 && !bucket) return false;
      }
      bucket = { count: 0, resetAt: now + 60_000 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= this.limit;
  }
}

function json(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function body(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
  ) {
    throw new ApiError(415, 'CONTENT_TYPE', 'Send the request body as application/json.');
  }
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new ApiError(415, 'CONTENT_ENCODING', 'Compressed request bodies are not supported.');
  }
  if (Number(request.headers['content-length'] ?? 0) > maxBytes) {
    request.resume();
    throw new ApiError(413, 'BODY_LIMIT', `Request bodies are limited to ${maxBytes} bytes.`);
  }
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(new ApiError(413, 'BODY_LIMIT', `Request bodies are limited to ${maxBytes} bytes.`));
      } else {
        chunks.push(chunk);
      }
    });
    request.once('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    request.once('error', () => {
      if (!settled)
        reject(new ApiError(400, 'INVALID_BODY', 'The request body could not be read.'));
    });
    request.once('aborted', () => {
      if (!settled) reject(new ApiError(400, 'INVALID_BODY', 'The request was interrupted.'));
    });
  });
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }
}

export function createApiServer(config: ServerConfig, sessions: SessionService) {
  const digest = secretDigest(config.accessToken);
  const owner = ownerId(config.accessToken);
  const requests = new RateLimiter(config.requestsPerMinute);
  const failures = new RateLimiter(20);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Vary', 'Origin');
    try {
      const ip = request.socket.remoteAddress ?? 'unknown';
      if (!requests.allow(ip)) {
        response.setHeader('Retry-After', '60');
        throw new ApiError(
          429,
          'RATE_LIMIT',
          'The request rate limit has been reached. Retry in a minute.',
        );
      }
      const origin = request.headers.origin;
      if (origin !== undefined) {
        if (!config.allowedOrigins.has(origin))
          throw new ApiError(403, 'ORIGIN_BLOCKED', 'This frontend origin is not permitted.');
        response.setHeader('Access-Control-Allow-Origin', origin);
      }
      if (request.method === 'OPTIONS') {
        if (!origin)
          throw new ApiError(
            403,
            'ORIGIN_REQUIRED',
            'Browser preflight requires an allowed Origin.',
          );
        const requestedHeaders = (request.headers['access-control-request-headers'] ?? '')
          .split(',')
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);
        if (
          requestedHeaders.some((header) => !['authorization', 'content-type'].includes(header))
        ) {
          throw new ApiError(403, 'CORS_HEADERS', 'The preflight requested unsupported headers.');
        }
        if (
          !['GET', 'POST', 'DELETE'].includes(
            request.headers['access-control-request-method'] ?? '',
          )
        ) {
          throw new ApiError(403, 'CORS_METHOD', 'The preflight requested an unsupported method.');
        }
        response.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600',
        });
        response.end();
        return;
      }
      const pathname = new URL(request.url ?? '/', 'http://browos.invalid').pathname;
      if (request.method === 'GET' && pathname === '/health') {
        json(response, 200, { status: 'ok', service: 'browos-chromium', version: '0.1.0' });
        return;
      }
      const token = readBearer(request.headers.authorization);
      if (!matchesSecret(token, digest)) {
        if (!failures.allow(ip)) {
          response.setHeader('Retry-After', '60');
          throw new ApiError(
            429,
            'AUTH_RATE_LIMIT',
            'Too many unsuccessful authentication attempts.',
          );
        }
        response.setHeader('WWW-Authenticate', 'Bearer realm="BROwOS"');
        throw new ApiError(401, 'UNAUTHORIZED', 'A valid BROwOS access token is required.');
      }
      if (request.method === 'POST' && pathname === '/api/sessions') {
        const dimensions = viewport(objectBody(await body(request, config.maxBodyBytes)));
        json(response, 201, await sessions.create(owner, dimensions));
        return;
      }
      const match = /^\/api\/sessions\/([a-zA-Z0-9_-]{32})(?:\/(navigate|action|frame))?$/.exec(
        pathname,
      );
      if (!match) throw new ApiError(404, 'NOT_FOUND', 'This API route does not exist.');
      const [, id, operation] = match;
      if (request.method === 'GET' && operation === 'frame') {
        const frame = await sessions.frame(owner, id);
        response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': frame.length });
        response.end(frame);
      } else if (request.method === 'GET' && operation === undefined) {
        json(response, 200, await sessions.read(owner, id));
      } else if (request.method === 'POST' && operation === 'navigate') {
        const target = parseNavigate(await body(request, config.maxBodyBytes));
        json(response, 200, await sessions.navigate(owner, id, target));
      } else if (request.method === 'POST' && operation === 'action') {
        const action = parseAction(await body(request, config.maxBodyBytes));
        json(response, 200, await sessions.action(owner, id, action));
      } else if (request.method === 'DELETE' && operation === undefined) {
        await sessions.remove(owner, id);
        response.writeHead(204);
        response.end();
      } else {
        throw new ApiError(
          405,
          'METHOD_NOT_ALLOWED',
          'This method is not available for the route.',
        );
      }
    } catch (error) {
      const safe = asApiError(error);
      if (!response.headersSent) {
        if (safe.status === 413) {
          response.setHeader('Connection', 'close');
          response.once('finish', () => request.destroy());
        }
        json(response, safe.status, { error: { code: safe.code, message: safe.message } });
      } else {
        response.destroy();
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  server.on('clientError', (_error, socket) => socket.destroy());
  return server;
}
