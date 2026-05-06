import { Router } from 'express';
import { POST_STATUSES, type PostStatus } from '@lbab/shared';
import { queueService } from '../services/queueService.js';
import { automationService } from '../services/automationService.js';
import { logService } from '../services/logService.js';
import { nowIso } from '../utils/date.js';

export const queueRouter = Router();

queueRouter.get('/api/posts', (req, res) => {
  const statusRaw = (req.query.status as string | undefined) ?? undefined;
  const status =
    statusRaw && POST_STATUSES.includes(statusRaw as PostStatus) ? (statusRaw as PostStatus) : undefined;
  const limit = Number(req.query.limit ?? 100);
  const offset = Number(req.query.offset ?? 0);
  const items = queueService.list({ status, limit, offset });
  res.json({ items });
});

queueRouter.post('/api/posts/:id/retry', (req, res) => {
  const id = Number(req.params.id);
  const item = queueService.getById(id);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  if (item.status !== 'failed' && item.status !== 'skipped') {
    return res.status(400).json({ ok: false, error: 'Only failed or skipped items can be retried.' });
  }
  const updated = queueService.setStatus(id, 'pending', { errorMessage: null });
  logService.info(`Retry requested for post ${id}.`);
  res.json({ ok: true, item: updated });
});

queueRouter.post('/api/posts/:id/skip', (req, res) => {
  const id = Number(req.params.id);
  const item = queueService.getById(id);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  const updated = queueService.setStatus(id, 'skipped');
  logService.info(`Post ${id} skipped.`);
  res.json({ ok: true, item: updated });
});

queueRouter.post('/api/posts/:id/post-now', async (req, res) => {
  const id = Number(req.params.id);
  const item = queueService.getById(id);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  if (item.status !== 'pending' && item.status !== 'failed' && item.status !== 'skipped') {
    return res.status(400).json({
      ok: false,
      error: `Cannot post item in status ${item.status}.`,
    });
  }
  // Force back to pending so postOne sees a clean state
  if (item.status !== 'pending') {
    queueService.setStatus(id, 'pending', { errorMessage: null });
  }
  const fresh = queueService.getById(id);
  if (!fresh) return res.status(404).json({ ok: false, error: 'Not found' });
  try {
    const result = await automationService.postOne(fresh);
    if (!result.success) {
      return res.status(502).json({ ok: false, error: result.error, postId: id });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logService.error('post-now endpoint failed.', { error, postId: id });
    res.status(500).json({ ok: false, error });
  }
});

queueRouter.delete('/api/posts', (req, res) => {
  const statusRaw = req.query.status as string | undefined;
  const status =
    statusRaw && POST_STATUSES.includes(statusRaw as PostStatus) ? (statusRaw as PostStatus) : undefined;
  const removed = queueService.clear(status);
  logService.info('Queue cleared.', { status: status ?? 'all', removed, at: nowIso() });
  res.json({ ok: true, removed });
});
