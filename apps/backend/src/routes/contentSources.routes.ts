import { Router } from 'express';
import { z } from 'zod';
import { contentSourceService } from '../services/contentSourceService.js';
import { logService } from '../services/logService.js';

export const contentSourcesRouter = Router();

const urlSchema = z
  .string()
  .trim()
  .refine((v) => /^https?:\/\//i.test(v), {
    message: 'URL must start with http:// or https://',
  });

const createSchema = z.object({
  url: urlSchema,
  label: z.string().trim().nullish(),
  categoryId: z.number().int().positive(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const updateSchema = z.object({
  url: urlSchema.optional(),
  label: z.string().trim().nullish(),
  categoryId: z.number().int().positive().optional(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

contentSourcesRouter.get('/api/content-sources', (_req, res) => {
  res.json({ items: contentSourceService.list() });
});

contentSourcesRouter.post('/api/content-sources', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
  }
  try {
    const created = contentSourceService.create(parsed.data);
    logService.info('Content source created.', { id: created.id, url: created.url, categoryId: created.categoryId });
    res.json({ ok: true, item: created });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

contentSourcesRouter.put('/api/content-sources/:id', (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
  }
  try {
    const updated = contentSourceService.update(id, parsed.data);
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

contentSourcesRouter.post('/api/content-sources/:id/disable', (req, res) => {
  const id = Number(req.params.id);
  try {
    const updated = contentSourceService.update(id, { isEnabled: false });
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

contentSourcesRouter.delete('/api/content-sources/:id', (req, res) => {
  const id = Number(req.params.id);
  contentSourceService.remove(id);
  logService.info('Content source deleted.', { id });
  res.json({ ok: true });
});
