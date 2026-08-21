import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestRegistry } from './requestRegistry.js';

/**
 * The registry is what makes a request/response protocol out of a WebSocket,
 * which has neither. Every in-flight request is a promise held here until the
 * extension answers, the timeout fires, or the socket drops.
 *
 * The failure this guards against is a silent hang: a dashboard request whose
 * promise is never settled because the browser tab went away.
 */
describe('RequestRegistry', () => {
  let registry: RequestRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new RequestRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a pending request with the value the extension returned', async () => {
    const pending = registry.create<string>('req-1', 5_000, 'timed out');
    expect(registry.size()).toBe(1);

    registry.resolve('req-1', 'generated text');

    await expect(pending).resolves.toBe('generated text');
    expect(registry.size()).toBe(0);
  });

  it('rejects a pending request when the extension reports an error', async () => {
    const pending = registry.create('req-2', 5_000, 'timed out');
    registry.reject('req-2', new Error('reader tab threw'));
    await expect(pending).rejects.toThrow('reader tab threw');
    expect(registry.size()).toBe(0);
  });

  it('times out a request the extension never answers', async () => {
    const pending = registry.create('req-3', 30_000, 'Reader tab did not respond');
    const assertion = expect(pending).rejects.toThrow('Reader tab did not respond');

    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    expect(registry.size()).toBe(0);
  });

  it('does not time out a request that was already resolved', async () => {
    const pending = registry.create<string>('req-4', 10_000, 'timed out');
    registry.resolve('req-4', 'done');
    await expect(pending).resolves.toBe('done');

    // Advancing past the original deadline must not produce an unhandled
    // rejection from a timer that should have been cleared.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(registry.size()).toBe(0);
  });

  it('reports false when resolving or rejecting an unknown request id', () => {
    expect(registry.resolve('never-existed', 'x')).toBe(false);
    expect(registry.reject('never-existed', new Error('x'))).toBe(false);
  });

  it('reports false for a request id that was already settled', async () => {
    const pending = registry.create<string>('req-5', 5_000, 'timed out');
    expect(registry.resolve('req-5', 'first')).toBe(true);
    await expect(pending).resolves.toBe('first');
    // A duplicate answer from a reconnecting extension must be ignored, not
    // crash and not resolve a second time.
    expect(registry.resolve('req-5', 'second')).toBe(false);
  });

  it('rejectAll settles every in-flight request when the socket drops', async () => {
    const a = registry.create('a', 60_000, 'timed out');
    const b = registry.create('b', 60_000, 'timed out');
    const c = registry.create('c', 60_000, 'timed out');
    expect(registry.size()).toBe(3);

    const assertions = [
      expect(a).rejects.toThrow('Extension disconnected'),
      expect(b).rejects.toThrow('Extension disconnected'),
      expect(c).rejects.toThrow('Extension disconnected'),
    ];
    registry.rejectAll('Extension disconnected');
    await Promise.all(assertions);

    expect(registry.size()).toBe(0);
  });

  it('leaves no timers behind after rejectAll, so a reconnect starts clean', async () => {
    const pending = registry.create('a', 10_000, 'original timeout message');
    const assertion = expect(pending).rejects.toThrow('socket closed');
    registry.rejectAll('socket closed');
    await assertion;

    // If rejectAll had failed to clear the timer, this would fire against an
    // already-settled promise.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(registry.size()).toBe(0);
  });

  it('rejectAll on an empty registry is a no-op', () => {
    expect(() => registry.rejectAll('nothing pending')).not.toThrow();
    expect(registry.size()).toBe(0);
  });

  it('keeps concurrent requests independent', async () => {
    const a = registry.create<string>('a', 5_000, 'timed out');
    const b = registry.create<string>('b', 5_000, 'timed out');

    registry.resolve('b', 'b-done');
    await expect(b).resolves.toBe('b-done');
    expect(registry.size()).toBe(1);

    registry.resolve('a', 'a-done');
    await expect(a).resolves.toBe('a-done');
    expect(registry.size()).toBe(0);
  });
});
