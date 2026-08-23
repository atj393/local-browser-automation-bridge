import { describe, it, expect } from 'vitest';
import { isAllowedSourceUrl } from './urlGuard.js';

/**
 * `isAllowedSourceUrl` is the SSRF boundary. Everything the backend fetches on
 * behalf of a user-supplied URL passes through it first, and again after any
 * redirect. These tests exist because a regression here turns a local content
 * fetcher into a probe for whatever else is listening on the machine.
 */
describe('isAllowedSourceUrl — SSRF boundary', () => {
  describe('rejects non-HTTP schemes', () => {
    const schemes = [
      'file:///etc/passwd',
      'ftp://example.com/x',
      'gopher://example.com/',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
    ];
    it.each(schemes)('rejects %s', (url) => {
      const result = isAllowedSourceUrl(url);
      expect(result.ok).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('rejects loopback and private ranges', () => {
    const blocked = [
      'http://localhost:4000/admin',
      'http://127.0.0.1/',
      'http://127.1.2.3/',
      'http://0.0.0.0/',
      'http://10.0.0.5/internal',
      'http://192.168.1.1/router',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://[::1]/',
    ];
    it.each(blocked)('rejects %s', (url) => {
      expect(isAllowedSourceUrl(url).ok).toBe(false);
    });
  });

  it('rejects the cloud instance-metadata address', () => {
    // 169.254.169.254 is the AWS/GCP/Azure metadata endpoint. On a developer
    // laptop it is inert; the moment this backend runs on any cloud instance it
    // is the single highest-value SSRF target there is, so it must be blocked
    // by the guard rather than by luck of deployment.
    expect(isAllowedSourceUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
  });

  it('rejects link-local addresses generally', () => {
    expect(isAllowedSourceUrl('http://169.254.1.1/').ok).toBe(false);
  });

  it('rejects IPv6 link-local and unspecified addresses', () => {
    expect(isAllowedSourceUrl('http://[fe80::1]/').ok).toBe(false);
    expect(isAllowedSourceUrl('http://[::]/').ok).toBe(false);
  });

  it('rejects a malformed URL rather than throwing', () => {
    expect(isAllowedSourceUrl('not a url').ok).toBe(false);
    expect(isAllowedSourceUrl('').ok).toBe(false);
  });

  it('is case-insensitive about the hostname', () => {
    expect(isAllowedSourceUrl('http://LOCALHOST/').ok).toBe(false);
  });

  describe('allows ordinary public sources', () => {
    const allowed = [
      'https://example.com/feed.xml',
      'http://example.com/feed.xml',
      'https://news.ycombinator.com/rss',
      'https://sub.domain.example.co.uk/path?query=1',
      // 172.32 is outside the private 172.16-172.31 block and must not be
      // over-blocked by a sloppy /^172\./ prefix match.
      'http://172.32.0.1/',
    ];
    it.each(allowed)('allows %s', (url) => {
      expect(isAllowedSourceUrl(url).ok).toBe(true);
    });
  });
});
