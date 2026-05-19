import { Router } from 'express';
import { z } from 'zod';
import { jsonExtractionService } from '../services/jsonExtractionService.js';
import { cleanItems } from '../services/promptService.js';
import { queueService } from '../services/queueService.js';
import { categoryService } from '../services/categoryService.js';
import { settingsService } from '../services/settingsService.js';
import { postScheduler } from '../scheduler/postScheduler.js';
import { logService } from '../services/logService.js';

export const ingestRawRouter = Router();

const schema = z.object({
  rawText: z.string().min(1).max(200_000),
  categoryId: z.number().int().positive().nullish(),
});

/**
 * Manual recovery path: accept a raw Gemini response that the
 * extension failed to auto-capture, run it through the same
 * jsonExtractionService → cleanItems → queueService.insertBatch
 * pipeline used by the automated flow, and re-arm the post scheduler.
 *
 * Source rotation is NOT consumed (sourceService.getNextSourceContext
 * has side effects). Category is chosen by the caller; null/missing
 * → categoryName='Manual paste', categoryId=null.
 */
ingestRawRouter.post('/api/batches/ingest-raw', (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
  }
  const { rawText, categoryId: rawCategoryId } = parsed.data;

  const extracted = jsonExtractionService.extract(rawText);
  if (extracted.error || !extracted.items.length) {
    logService.warn('Manual ingest: could not parse pasted text.', {
      error: extracted.error,
      preview: extracted.preview,
    });
    return res.status(400).json({
      ok: false,
      error: extracted.error ?? 'No items found in pasted text.',
      preview: extracted.preview,
    });
  }

  const settings = settingsService.get();
  const maxItems = Math.max(1, Math.min(50, settings.postsPerGeneration || 10));
  const { cleaned, trimmedCount, droppedCount } = cleanItems(extracted.items, maxItems);
  if (cleaned.length === 0) {
    const msg = `No valid posts after cleaning (${extracted.items.length} parsed).`;
    logService.warn(msg, { trimmedCount, droppedCount });
    return res
      .status(400)
      .json({ ok: false, error: msg, preview: extracted.preview });
  }

  // Resolve category (optional). Missing / null → manual placeholder.
  let categoryId: number | null = null;
  let categoryName: string = 'Manual paste';
  if (rawCategoryId != null) {
    const cat = categoryService.getById(rawCategoryId);
    if (!cat) {
      return res
        .status(400)
        .json({ ok: false, error: `Category ${rawCategoryId} not found.` });
    }
    categoryId = cat.id;
    categoryName = cat.name;
  }

  const { batchId, items } = queueService.insertBatch(cleaned, {
    sourceId: null,
    sourceUrl: null,
    categoryId,
    categoryName,
  });

  logService.info('Manual ingest accepted.', {
    batchId,
    inserted: items.length,
    droppedCount,
    trimmedCount,
    categoryId,
    categoryName,
  });

  // If automation is running, append the new batch to the existing
  // schedule (same hook used by the auto-generated path).
  if (settings.isRunning) {
    postScheduler.onScheduleAffectingChange('manual-ingest-raw');
  }

  res.json({
    ok: true,
    inserted: items.length,
    batchId,
    trimmedCount,
    droppedCount,
  });
});
