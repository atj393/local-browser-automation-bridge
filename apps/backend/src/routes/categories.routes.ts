import { Router } from 'express';
import { z } from 'zod';
import { categoryService } from '../services/categoryService.js';
import { logService } from '../services/logService.js';

export const categoriesRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  color: z.string().nullish(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().nullish(),
  color: z.string().nullish(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

categoriesRouter.get('/api/categories', (_req, res) => {
  res.json({ items: categoryService.list() });
});

categoriesRouter.post('/api/categories', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
  }
  try {
    const created = categoryService.create(parsed.data);
    logService.info('Category created.', { id: created.id, name: created.name });
    res.json({ ok: true, item: created });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

categoriesRouter.put('/api/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
  }
  try {
    const updated = categoryService.update(id, parsed.data);
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

categoriesRouter.post('/api/categories/:id/disable', (req, res) => {
  const id = Number(req.params.id);
  try {
    const updated = categoryService.disable(id);
    logService.info('Category disabled.', { id });
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

categoriesRouter.delete('/api/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = categoryService.remove(id);
  if (!result.ok) return res.status(409).json({ ok: false, error: result.error });
  logService.info('Category deleted.', { id });
  res.json({ ok: true });
});
