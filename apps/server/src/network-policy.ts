import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ApiError } from './errors.js';

export type DnsAnswer = { address: string; family: number };
export type DnsResolver = (hostname: string) => Promise<DnsAnswer[]>;

function ipv4Parts(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  return address.split('.').map(Number);
}

/** Conservative public-unicast allowlist; special-use/transition ranges fail closed. */
export function isPublicAddress(address: string): boolean {
  const v4 = ipv4Parts(address);
  if (v4) {
    const [a, b, c] = v4;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6 || address.includes('%')) return false;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [first = '', second = ''] = normalized.split(':');
  const prefix = Number.parseInt(first, 16);
  const subprefix = second === '' ? 0 : Number.parseInt(second, 16);
  if (prefix < 0x2000 || prefix > 0x3fff || !Number.isFinite(prefix)) return false;
  if (prefix === 0x2002) return false; // 6to4 embeds IPv4 destinations.
  if (prefix === 0x2001 && (subprefix < 0x0200 || subprefix === 0x0db8)) return false;
  return true;
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function deniedHostname(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'instance-data' ||
    (!host.includes('.') && isIP(host) === 0)
  );
}

export interface NetworkPolicyOptions {
  resolver?: DnsResolver;
  /** Injectable fixture route only; never read from deployment environment. */
  testOnlyLoopbackPort?: number;
}

export class PublicNetworkPolicy {
  private readonly resolve: DnsResolver;
  private readonly testOnlyLoopbackPort?: number;

  constructor(options: NetworkPolicyOptions = {}) {
    this.resolve =
      options.resolver ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
    if (options.testOnlyLoopbackPort !== undefined && process.env.NODE_ENV !== 'test') {
      throw new Error('Loopback fixtures are available only in the test process.');
    }
    this.testOnlyLoopbackPort = options.testOnlyLoopbackPort;
  }

  validateUrl(input: string): URL {
    let url: URL;
    try {
      if (
        input.length > 4096 ||
        [...input].some(
          (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new Error();
      url = new URL(input);
    } catch {
      throw new ApiError(400, 'INVALID_URL', 'Enter a valid HTTP or HTTPS URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ApiError(
        400,
        'URL_BLOCKED',
        'Only HTTP(S) URLs without embedded credentials are allowed.',
      );
    }
    const hostname = hostnameOf(url);
    if (this.isFixture(url)) return url;
    if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) {
      throw new ApiError(
        400,
        'URL_BLOCKED',
        'Only the standard HTTP and HTTPS ports are available.',
      );
    }
    if (
      !hostname ||
      deniedHostname(hostname) ||
      (isIP(hostname) > 0 && !isPublicAddress(hostname))
    ) {
      throw new ApiError(
        400,
        'URL_BLOCKED',
        'Local, private and special-use network addresses are blocked.',
      );
    }
    return url;
  }

  async resolveTarget(
    input: string,
  ): Promise<{ url: URL; address: string; family: 4 | 6; port: number }> {
    const url = this.validateUrl(input);
    const hostname = hostnameOf(url);
    if (this.isFixture(url)) {
      return { url, address: '127.0.0.1', family: 4, port: Number(url.port) };
    }
    const literalFamily = isIP(hostname);
    let addresses: DnsAnswer[];
    try {
      addresses = literalFamily
        ? [{ address: hostname, family: literalFamily }]
        : await Promise.race([
            this.resolve(hostname),
            new Promise<never>((_, reject) => {
              const timer = setTimeout(() => reject(new Error('DNS lookup timeout')), 5000);
              timer.unref();
            }),
          ]);
    } catch {
      throw new ApiError(400, 'DNS_FAILED', 'The destination could not be resolved.');
    }
    if (
      addresses.length === 0 ||
      addresses.length > 64 ||
      addresses.some((entry) => !isPublicAddress(entry.address) || ![4, 6].includes(entry.family))
    ) {
      throw new ApiError(
        400,
        'URL_BLOCKED',
        'The destination resolves to a private or special-use address.',
      );
    }
    const chosen = addresses.find((answer) => answer.family === 4) ?? addresses[0];
    return {
      url,
      address: chosen.address,
      family: chosen.family as 4 | 6,
      port: Number(url.port || (url.protocol === 'https:' ? '443' : '80')),
    };
  }

  private isFixture(url: URL): boolean {
    return (
      this.testOnlyLoopbackPort !== undefined &&
      url.protocol === 'http:' &&
      ['127.0.0.1', 'browos-fixture.invalid'].includes(hostnameOf(url)) &&
      Number(url.port) === this.testOnlyLoopbackPort
    );
  }
}
