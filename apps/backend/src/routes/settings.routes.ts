import { Router } from 'express';
import { z } from 'zod';
import { settingsService } from '../services/settingsService.js';
import { logService } from '../services/logService.js';

export const settingsRouter = Router();

const updateSchema = z.object({
  llmPrompt: z.string().min(1, 'llmPrompt cannot be empty'),
  batchSize: z.number().int().min(1).max(50),
  minIntervalSeconds: z.number().int().min(10),
  maxIntervalSeconds: z.number().int().min(10).max(86_400),
  autoSubmitWriter: z.boolean(),
  writerUrlPattern: z.string().min(1),
  readerUrlPattern: z.string().min(1),
}).refine((d) => d.maxIntervalSeconds >= d.minIntervalSeconds, {
  message: 'maxIntervalSeconds must be greater than or equal to minIntervalSeconds',
  path: ['maxIntervalSeconds'],
});

settingsRouter.get('/api/settings', (_req, res) => {
  res.json(settingsService.get());
});

settingsRouter.put('/api/settings', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid settings', details: parsed.error.flatten() });
  }
  const updated = settingsService.update(parsed.data);
  logService.info('Settings updated.', {
    autoSubmitWriter: updated.autoSubmitWriter,
    batchSize: updated.batchSize,
    minIntervalSeconds: updated.minIntervalSeconds,
    maxIntervalSeconds: updated.maxIntervalSeconds,
  });
  res.json(updated);
});
