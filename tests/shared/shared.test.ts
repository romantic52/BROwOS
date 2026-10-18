import { describe, expect, it } from 'vitest';
import { errorMessage, formatBytes, normalizeWebUrl } from '../../packages/shared/src/index';

describe('browser address normalization', () => {
  it.each([
    ['', 'browos://home'],
    ['  browos://home  ', 'browos://home'],
    ['browos://about', 'browos://about'],
    ['example.com', 'https://example.com/'],
    ['example.com:8080/path?q=1', 'https://example.com:8080/path?q=1'],
    ['localhost:3000/app', 'http://localhost:3000/app'],
    ['localhost', 'http://localhost/'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080/'],
    ['[::1]:3000', 'http://[::1]:3000/'],
    ['https://example.com/a b', 'https://example.com/a%20b'],
    ['//example.com/path', 'https://example.com/path'],
  ])('normalizes %s to %s', (input, expected) => expect(normalizeWebUrl(input)).toBe(expected));

  it('encodes human queries into a search URL without interpreting them as executable content', () => {
    const query = 'BROwOS files & folders / поиск';
    const url = new URL(normalizeWebUrl(query));
    expect(url.origin).toBe('https://www.bing.com');
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe(query);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt://example.com/alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'browos://unknown',
    'https://user:password@example.com/',
    '//user:password@example.com/',
    'https://[not-an-ipv6-address',
  ])('rejects unsupported schemes, embedded credentials and malformed addresses: %s', (input) =>
    expect(() => normalizeWebUrl(input)).toThrow(),
  );
});

describe('shared display helpers', () => {
  it('formats byte counts at actual unit boundaries', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(1023)).toBe('1023 Б');
    expect(formatBytes(1024)).toBe('1.0 КБ');
    expect(formatBytes(1536)).toBe('1.5 КБ');
    expect(formatBytes(1_048_576)).toBe('1.0 МБ');
  });
  it('exposes Error messages without treating arbitrary objects as trusted errors', () => {
    expect(errorMessage(new Error('Disk full'))).toBe('Disk full');
    expect(errorMessage({ message: 'Untrusted arbitrary object' })).toBe(
      'Не удалось выполнить операцию',
    );
  });
});
