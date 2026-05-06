import { Router } from 'express';
import { z } from 'zod';
import {
  BATCH_REFILL_MODES,
  POSTS_PER_GENERATION_MAX,
  POSTS_PER_GENERATION_MIN,
  SOURCE_MODES,
} from '@lbab/shared';
import { settingsService } from '../services/settingsService.js';
import { queueService } from '../services/queueService.js';
import { logService } from '../services/logService.js';
import { postScheduler } from '../scheduler/postScheduler.js';
import { batchScheduler } from '../scheduler/batchScheduler.js';

export const settingsRouter = Router();

const sourceUrlSchema = z
  .string()
  .trim()
  .refine((v) => v.length === 0 || /^https?:\/\//i.test(v), {
    message: 'Source URLs must start with http:// or https://',
  });

const updateSchema = z
  .object({
    llmPrompt: z.string().min(1, 'llmPrompt cannot be empty'),
    postsPerGeneration: z
      .number()
      .int()
      .min(POSTS_PER_GENERATION_MIN)
      .max(POSTS_PER_GENERATION_MAX),
    minIntervalSeconds: z.number().int().min(10),
    maxIntervalSeconds: z.number().int().min(10).max(86_400),
    autoSubmitWriter: z.boolean(),
    writerUrlPattern: z.string().min(1),
    readerUrlPattern: z.string().min(1),
    sourceUrls: z.array(sourceUrlSchema).default([]),
    sourceMode: z.enum(SOURCE_MODES),
    batchMinIntervalSeconds: z.number().int().min(10),
    batchMaxIntervalSeconds: z.number().int().min(10).max(86_400),
    batchRefillMode: z.enum(BATCH_REFILL_MODES),
  })
  .refine((d) => d.maxIntervalSeconds >= d.minIntervalSeconds, {
    message: 'maxIntervalSeconds must be greater than or equal to minIntervalSeconds',
    path: ['maxIntervalSeconds'],
  })
  .refine((d) => d.batchMaxIntervalSeconds >= d.batchMinIntervalSeconds, {
    message:
      'batchMaxIntervalSeconds must be greater than or equal to batchMinIntervalSeconds',
    path: ['batchMaxIntervalSeconds'],
  });

settingsRouter.get('/api/settings', (_req, res) => {
  res.json(settingsService.get());
});

settingsRouter.put('/api/settings', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid settings', details: parsed.error.flatten() });
  }
  const cleanedUrls = parsed.data.sourceUrls
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  const before = settingsService.get();
  const updated = settingsService.update({ ...parsed.data, sourceUrls: cleanedUrls });
  logService.info('Settings updated.', {
    autoSubmitWriter: updated.autoSubmitWriter,
    postsPerGeneration: updated.postsPerGeneration,
    minIntervalSeconds: updated.minIntervalSeconds,
    maxIntervalSeconds: updated.maxIntervalSeconds,
    sourceMode: updated.sourceMode,
    sourceUrlsCount: updated.sourceUrls.length,
    batchMinIntervalSeconds: updated.batchMinIntervalSeconds,
    batchMaxIntervalSeconds: updated.batchMaxIntervalSeconds,
    batchRefillMode: updated.batchRefillMode,
  });

  // Post interval change → recompute or clear post-scheduler plan.
  const postIntervalChanged =
    before.minIntervalSeconds !== updated.minIntervalSeconds ||
    before.maxIntervalSeconds !== updated.maxIntervalSeconds;
  if (postIntervalChanged) {
    if (updated.isRunning) {
      logService.info('Settings interval changed; schedule recalculated.');
      postScheduler.onScheduleAffectingChange('settings-interval-changed');
    } else {
      queueService.clearSchedule();
      settingsService.setNextRunAt(null);
      logService.info(
        'Settings interval changed while stopped; cleared stale scheduled_for values.',
      );
    }
  }

  // Batch interval / refill-mode change → re-arm batch scheduler.
  const batchSettingsChanged =
    before.batchMinIntervalSeconds !== updated.batchMinIntervalSeconds ||
    before.batchMaxIntervalSeconds !== updated.batchMaxIntervalSeconds ||
    before.batchRefillMode !== updated.batchRefillMode;
  if (batchSettingsChanged) {
    logService.info('Batch interval settings changed; batch schedule recalculated.');
    batchScheduler.onSettingsChanged();
  }

  res.json(updated);
});
