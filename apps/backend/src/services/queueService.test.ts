import { describe, it, expect } from 'vitest';
import { orderItemsForPosting } from './queueService.js';
import type { PostQueueItem } from '@lbab/shared';

/**
 * `orderItemsForPosting` decides what gets posted next. `rotate_categories`
 * exists so a queue that happens to hold twelve items from one category does
 * not post twelve of them in a row, which is both obviously robotic and the
 * fastest way to get an account actioned.
 */
function item(id: number, categoryId: number | null, createdAt: string): PostQueueItem {
  return { id, categoryId, createdAt } as unknown as PostQueueItem;
}

const ids = (items: PostQueueItem[]) => items.map((i) => i.id);

describe('orderItemsForPosting', () => {
  describe('oldest_first', () => {
    it('returns items unchanged', () => {
      const items = [
        item(1, 10, '2026-01-01T00:00:00Z'),
        item(2, 10, '2026-01-02T00:00:00Z'),
        item(3, 20, '2026-01-03T00:00:00Z'),
      ];
      expect(ids(orderItemsForPosting(items, null, 'oldest_first'))).toEqual([1, 2, 3]);
    });

    it('returns a copy, not the caller\'s array', () => {
      const items = [item(1, 10, '2026-01-01T00:00:00Z')];
      const result = orderItemsForPosting(items, null, 'oldest_first');
      expect(result).not.toBe(items);
    });
  });

  describe('rotate_categories', () => {
    it('alternates categories instead of draining one', () => {
      const items = [
        item(1, 10, '2026-01-01T00:00:00Z'),
        item(2, 10, '2026-01-02T00:00:00Z'),
        item(3, 10, '2026-01-03T00:00:00Z'),
        item(4, 20, '2026-01-04T00:00:00Z'),
        item(5, 20, '2026-01-05T00:00:00Z'),
      ];
      const result = orderItemsForPosting(items, null, 'rotate_categories');
      const cats = result.map((i) => i.categoryId);
      // No two consecutive picks share a category while both buckets are live.
      expect(cats.slice(0, 4)).toEqual([10, 20, 10, 20]);
      expect(ids(result).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it('does not repeat the category that was posted last', () => {
      const items = [
        item(1, 10, '2026-01-01T00:00:00Z'),
        item(2, 20, '2026-01-02T00:00:00Z'),
      ];
      // Category 10 was the previous post, so 20 must come first.
      const result = orderItemsForPosting(items, 10, 'rotate_categories');
      expect(result[0]!.categoryId).toBe(20);
    });

    it('falls back to oldest-first when only one category remains', () => {
      const items = [
        item(1, 10, '2026-01-01T00:00:00Z'),
        item(2, 10, '2026-01-02T00:00:00Z'),
        item(3, 10, '2026-01-03T00:00:00Z'),
      ];
      expect(ids(orderItemsForPosting(items, 10, 'rotate_categories'))).toEqual([1, 2, 3]);
    });

    it('preserves age order within a category', () => {
      const items = [
        item(1, 10, '2026-01-01T00:00:00Z'),
        item(2, 20, '2026-01-02T00:00:00Z'),
        item(3, 10, '2026-01-03T00:00:00Z'),
        item(4, 20, '2026-01-04T00:00:00Z'),
      ];
      const result = orderItemsForPosting(items, null, 'rotate_categories');
      const cat10 = result.filter((i) => i.categoryId === 10).map((i) => i.id);
      const cat20 = result.filter((i) => i.categoryId === 20).map((i) => i.id);
      expect(cat10).toEqual([1, 3]);
      expect(cat20).toEqual([2, 4]);
    });

    it('never drops or duplicates an item', () => {
      const items = [
        item(1, 10, '2026-01-01T00:00:00Z'),
        item(2, 20, '2026-01-02T00:00:00Z'),
        item(3, null, '2026-01-03T00:00:00Z'),
        item(4, 10, '2026-01-04T00:00:00Z'),
        item(5, 30, '2026-01-05T00:00:00Z'),
        item(6, null, '2026-01-06T00:00:00Z'),
      ];
      const result = orderItemsForPosting(items, null, 'rotate_categories');
      expect(result).toHaveLength(6);
      expect(ids(result).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('treats uncategorised (null) as a real bucket, including as "last posted"', () => {
      const items = [
        item(1, null, '2026-01-01T00:00:00Z'),
        item(2, null, '2026-01-02T00:00:00Z'),
        item(3, 10, '2026-01-03T00:00:00Z'),
      ];
      // Seeding lastCategoryId = null means the previous post was itself
      // uncategorised, so the null bucket is skipped first exactly like any
      // other repeat. The categorised item leads.
      const seededNull = orderItemsForPosting(items, null, 'rotate_categories');
      expect(seededNull.map((i) => i.categoryId)).toEqual([10, null, null]);

      // With a different category as the seed, the oldest null item leads.
      const seededTen = orderItemsForPosting(items, 10, 'rotate_categories');
      expect(seededTen[0]!.categoryId).toBeNull();
      expect(seededTen[0]!.id).toBe(1);
    });

    it('handles an empty queue and a single item', () => {
      expect(orderItemsForPosting([], null, 'rotate_categories')).toEqual([]);
      const one = [item(1, 10, '2026-01-01T00:00:00Z')];
      expect(ids(orderItemsForPosting(one, null, 'rotate_categories'))).toEqual([1]);
    });
  });
});
