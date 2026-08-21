import { describe, it, expect } from 'vitest';
import { getRandomDelay } from './randomDelay.js';

/**
 * Posts are spaced by a randomised delay rather than a fixed interval. The
 * exact distribution matters less than the invariants: always positive, always
 * inside the requested window, and never throwing on inverted or nonsense
 * input — a scheduler that throws stops the whole queue.
 */
describe('getRandomDelay', () => {
  it('returns a value inside the requested window, in milliseconds', () => {
    for (let i = 0; i < 200; i++) {
      const ms = getRandomDelay(5, 10);
      expect(ms).toBeGreaterThanOrEqual(5_000);
      expect(ms).toBeLessThanOrEqual(10_000);
      expect(ms % 1000).toBe(0);
    }
  });

  it('handles min === max as a fixed delay', () => {
    expect(getRandomDelay(7, 7)).toBe(7_000);
  });

  it('clamps an inverted window instead of returning a negative delay', () => {
    for (let i = 0; i < 50; i++) {
      const ms = getRandomDelay(10, 2);
      expect(ms).toBeGreaterThanOrEqual(10_000);
    }
  });

  it('never returns less than one second, even for zero or negative input', () => {
    expect(getRandomDelay(0, 0)).toBe(1_000);
    expect(getRandomDelay(-30, -5)).toBe(1_000);
  });

  it('floors fractional seconds', () => {
    const ms = getRandomDelay(2.9, 2.9);
    expect(ms).toBe(2_000);
  });

  it('actually varies across a wide window', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(getRandomDelay(1, 60));
    expect(seen.size).toBeGreaterThan(5);
  });
});
