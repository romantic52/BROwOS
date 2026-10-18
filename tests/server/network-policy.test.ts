import { describe, expect, it, vi } from 'vitest';
import { isPublicAddress, PublicNetworkPolicy } from '../../apps/server/src/network-policy.js';
import { readConfig } from '../../apps/server/src/config.js';
import { parseAction, viewport } from '../../apps/server/src/protocol.js';

describe('Connected browser network boundary', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.10.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    'fe80::1',
    'fd12::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '2001::1',
    '64:ff9b::7f00:1',
  ])('rejects private/special address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.215.14', '2606:4700:4700::1111'])(
    'accepts public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/a',
    'javascript:alert(1)',
    'data:text/html,x',
    'http://localhost/',
    'http://localhost./',
    'http://abc.localhost/',
    'http://metadata.google.internal/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::ffff:127.0.0.1]/',
    'http://example.com:8080/',
    'https://user:password@example.com/',
    'https://example.com/\nsecret',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => new PublicNetworkPolicy().validateUrl(url)).toThrow();
  });

  it('rejects a public-looking DNS name when any answer is private', async () => {
    const resolver = vi.fn(async () => [
      { address: '93.184.215.14', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(
      new PublicNetworkPolicy({ resolver }).resolveTarget('https://example.com/'),
    ).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('pins the validated numeric address and rechecks DNS on the next connection', async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.215.14', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const policy = new PublicNetworkPolicy({ resolver });
    const first = await policy.resolveTarget('https://example.com/path');
    expect(first).toMatchObject({ address: '93.184.215.14', family: 4, port: 443 });
    expect(first.url.hostname).toBe('example.com');
    await expect(policy.resolveTarget('https://example.com/path')).rejects.toMatchObject({
      code: 'URL_BLOCKED',
    });
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('keeps loopback denied in the default production policy even during tests', async () => {
    await expect(
      new PublicNetworkPolicy().resolveTarget('http://127.0.0.1:34567'),
    ).rejects.toMatchObject({ code: 'URL_BLOCKED' });
  });

  it('limits the injected loopback fixture to a single HTTP port', async () => {
    const policy = new PublicNetworkPolicy({ testOnlyLoopbackPort: 34567 });
    expect(await policy.resolveTarget('http://browos-fixture.invalid:34567/check')).toMatchObject({
      address: '127.0.0.1',
      port: 34567,
    });
    expect(() => policy.validateUrl('http://127.0.0.1:34568')).toThrow();
    expect(() => policy.validateUrl('http://192.168.1.1:34567')).toThrow();
  });
});

describe('Connected configuration and protocol limits', () => {
  const token = 'example-test-owner-token-with-at-least-32-characters';
  it('requires a strong explicit token and exact HTTPS remote origins', () => {
    expect(() => readConfig({})).toThrow(/BROWOS_ACCESS_TOKEN/);
    expect(() => readConfig({ BROWOS_ACCESS_TOKEN: 'short' })).toThrow();
    expect(() => readConfig({ BROWOS_ACCESS_TOKEN: token, BROWOS_ALLOWED_ORIGINS: '*' })).toThrow();
    expect(() =>
      readConfig({ BROWOS_ACCESS_TOKEN: token, BROWOS_ALLOWED_ORIGINS: 'http://example.com' }),
    ).toThrow(/HTTPS/);
    expect(() =>
      readConfig({ BROWOS_ACCESS_TOKEN: token, BROWOS_ALLOWED_ORIGINS: 'https://example.com/' }),
    ).toThrow();
    expect(
      readConfig({ BROWOS_ACCESS_TOKEN: token, BROWOS_ALLOWED_ORIGINS: 'https://example.com' })
        .host,
    ).toBe('127.0.0.1');
  });

  it('bounds viewports, pointer input, keystrokes and pasted text', () => {
    expect(viewport({})).toEqual({ width: 1280, height: 720 });
    expect(() => viewport({ width: 16000 })).toThrow();
    expect(() => viewport({ width: 500.5 })).toThrow();
    expect(() => parseAction({ type: 'click', x: -1, y: 4 })).toThrow();
    expect(() => parseAction({ type: 'wheel', deltaX: 0, deltaY: Infinity })).toThrow();
    expect(() => parseAction({ type: 'evaluate', script: 'process.env' })).toThrow();
    expect(() => parseAction({ type: 'text', text: 'a'.repeat(2049) })).toThrow();
    expect(() => parseAction({ type: 'key', key: '\n' })).toThrow();
    expect(parseAction({ type: 'key', key: 'Control+A' })).toEqual({
      type: 'key',
      key: 'Control+A',
    });
  });
});
