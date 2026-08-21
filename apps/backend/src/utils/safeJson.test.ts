import { describe, it, expect } from 'vitest';
import { safeParse, safeStringify } from './safeJson.js';

/**
 * Everything crossing the WebSocket or coming back out of SQLite is a string
 * that a previous version of this app wrote. These helpers exist so a single
 * malformed row cannot take down the scheduler.
 */
describe('safeStringify', () => {
  it('serialises ordinary values', () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
    expect(safeStringify([1, 2])).toBe('[1,2]');
    expect(safeStringify('text')).toBe('"text"');
  });

  it('returns an error marker instead of throwing on a circular structure', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    expect(() => safeStringify(circular)).not.toThrow();
    expect(safeStringify(circular)).toBe('{"error":"unserializable"}');
  });

  it('returns an error marker for a BigInt, which JSON cannot represent', () => {
    expect(safeStringify({ big: 1n })).toBe('{"error":"unserializable"}');
  });
});

describe('safeParse', () => {
  it('parses valid JSON', () => {
    expect(safeParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(safeParse<number[]>('[1,2]')).toEqual([1, 2]);
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(safeParse('{not json')).toBeNull();
    expect(safeParse('undefined')).toBeNull();
  });

  it('returns null for empty and nullish input', () => {
    expect(safeParse('')).toBeNull();
    expect(safeParse(null)).toBeNull();
    expect(safeParse(undefined)).toBeNull();
  });

  it('round-trips through safeStringify', () => {
    const value = { title: 'a post', tags: ['x', 'y'], count: 3 };
    expect(safeParse(safeStringify(value))).toEqual(value);
  });
});
