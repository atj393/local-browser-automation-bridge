/**
 * SSRF guard for user-supplied source URLs.
 *
 * Deliberately dependency-free: this module is the security boundary for every
 * outbound fetch the backend performs on a user's behalf, so it must be
 * importable — and testable — without pulling in the database, the logger, or
 * the HTML extraction stack.
 *
 * Applied twice per fetch: once to the submitted URL, and again to the final
 * URL after redirects, because a public host can redirect to a private one.
 */

const PRIVATE_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1', '[::1]']);

const PRIVATE_IP_PREFIXES = [
  /^127\./, // loopback
  /^10\./, // RFC1918 class A
  /^192\.168\./, // RFC1918 class C
  /^169\.254\./, // RFC3927 link-local — includes cloud instance metadata
];

// RFC1918 class B: 172.16.0.0 - 172.31.255.255 only. A bare /^172\./ would
// wrongly block the public 172.32+ space.
const PRIVATE_172_RE = /^172\.(1[6-9]|2\d|3[01])\./;

export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
}

export function isAllowedSourceUrl(raw: string): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Protocol ${url.protocol} not allowed` };
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(host)) {
    return { ok: false, reason: `Hostname ${host} is private` };
  }
  if (PRIVATE_IP_PREFIXES.some((re) => re.test(host)) || PRIVATE_172_RE.test(host)) {
    return { ok: false, reason: `IP ${host} is in a private range` };
  }
  if (host.startsWith('[fe80') || host === '[::]') {
    return { ok: false, reason: `IPv6 ${host} is private` };
  }
  return { ok: true };
}
