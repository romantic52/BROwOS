export const VERSION = '0.1.0';
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию';
}
export function normalizeWebUrl(value: string): string {
  const input = value.trim();
  if (/^browos:\/\/(home|about)$/.test(input)) return input;
  if (!input) return 'browos://home';
  // A dotted hostname followed by a numeric port is an address, not a URL scheme.
  // All remaining explicit schemes still pass through the strict protocol check.
  const bareHost = input.match(
    /^(localhost|[^:/?#\s@]+\.[^:/?#\s@]+|\[[^\]\s]+\])(?::\d{1,5})?(?=[/?#]|$)/i,
  );
  let candidate: string;
  if (bareHost) {
    const host = bareHost[1].toLowerCase();
    const local =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '127.0.0.1' ||
      host === '[::1]';
    candidate = `${local ? 'http' : 'https'}://${input}`;
  } else if (input.startsWith('//')) candidate = `https:${input}`;
  else if (/^[a-z][a-z\d+.-]*:/i.test(input)) candidate = input;
  else candidate = `https://www.bing.com/search?q=${encodeURIComponent(input)}`;
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Разрешены только адреса HTTP и HTTPS');
  if (url.username || url.password)
    throw new Error('Адрес с логином или паролем не поддерживается');
  return url.href;
}
