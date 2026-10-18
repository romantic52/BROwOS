export interface ServerConfig {
  accessToken: string;
  host: string;
  port: number;
  allowedOrigins: ReadonlySet<string>;
  maxSessions: number;
  idleTimeoutMs: number;
  maxSessionLifetimeMs: number;
  navigationTimeoutMs: number;
  requestsPerMinute: number;
  maxBodyBytes: number;
}

function integer(
  source: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const input = source[key];
  if (input === undefined || input === '') return fallback;
  if (!/^\d+$/.test(input)) throw new Error(`${key} must be an integer.`);
  const value = Number(input);
  if (value < minimum || value > maximum) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function readConfig(source: NodeJS.ProcessEnv = process.env): ServerConfig {
  const accessToken = source.BROWOS_ACCESS_TOKEN ?? '';
  if (accessToken.length < 32 || accessToken.length > 256 || /\s/.test(accessToken)) {
    throw new Error('BROWOS_ACCESS_TOKEN must contain 32–256 non-whitespace characters.');
  }
  const origins = (source.BROWOS_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.length > 16) {
    throw new Error('BROWOS_ALLOWED_ORIGINS must list 1–16 exact origins.');
  }
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('BROWOS_ALLOWED_ORIGINS contains an invalid origin.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password
    ) {
      throw new Error(
        'BROWOS_ALLOWED_ORIGINS requires exact HTTP(S) origins, with no trailing slash.',
      );
    }
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Remote frontend origins must use HTTPS.');
    }
  }
  return {
    accessToken,
    host: source.BROWOS_HOST ?? '127.0.0.1',
    port: integer(source, 'BROWOS_PORT', 3001, 1, 65535),
    allowedOrigins: new Set(origins),
    maxSessions: integer(source, 'BROWOS_MAX_SESSIONS', 4, 1, 16),
    idleTimeoutMs: integer(source, 'BROWOS_IDLE_TIMEOUT_MS', 600_000, 10_000, 3_600_000),
    maxSessionLifetimeMs: integer(source, 'BROWOS_MAX_LIFETIME_MS', 3_600_000, 60_000, 86_400_000),
    navigationTimeoutMs: integer(source, 'BROWOS_NAVIGATION_TIMEOUT_MS', 15_000, 1_000, 30_000),
    requestsPerMinute: integer(source, 'BROWOS_REQUESTS_PER_MINUTE', 600, 30, 1800),
    maxBodyBytes: 16_384,
  };
}
