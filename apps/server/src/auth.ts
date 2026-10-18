import { createHash, timingSafeEqual } from 'node:crypto';

export function secretDigest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function matchesSecret(candidate: string, expectedDigest: Buffer): boolean {
  return timingSafeEqual(secretDigest(candidate), expectedDigest);
}

export function readBearer(header: string | undefined): string {
  const match = /^Bearer ([^\s]{1,256})$/.exec(header ?? '');
  return match?.[1] ?? '';
}

/** All sessions belong to the single configured owner credential, never to an IP. */
export function ownerId(token: string): string {
  return secretDigest(`browos-owner:${token}`).toString('hex');
}
