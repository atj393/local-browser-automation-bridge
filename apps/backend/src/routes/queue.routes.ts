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

  // Compute queuePosition (1-based among pending, ordered by created_at ASC, id ASC)
  // and countdownSeconds for pending items with a scheduled_for value.
  const pendingOrdered = queueService.listPending();
  const positionById = new Map<number, number>();
  pendingOrdered.forEach((p, idx) => positionById.set(p.id, idx + 1));

  const now = Date.now();
  const decorated = items.map((it) => {
    const queuePosition = positionById.get(it.id) ?? null;
    let countdownSeconds: number | null = null;
    if (it.status === 'pending' && it.scheduledFor) {
      const t = Date.parse(it.scheduledFor);
      if (!Number.isNaN(t)) countdownSeconds = Math.max(0, Math.round((t - now) / 1000));
    }
    return { ...it, queuePosition, countdownSeconds };
  });

  res.json({ items: decorated });
});

queueRouter.post('/api/posts/:id/retry', (req, res) => {
  const id = Number(req.params.id);
  const item = queueService.getById(id);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  const allowed: Array<typeof item.status> = ['failed', 'skipped', 'needs_manual_post'];
  if (!allowed.includes(item.status)) {
    return res.status(400).json({
      ok: false,
      error: 'Only failed, skipped, or needs_manual_post items can be retried.',
    });
  }
  const updated = queueService.setStatus(id, 'pending', { errorMessage: null });
  logService.info(`Retry requested for post ${id}.`, { previousStatus: item.status });
  res.json({ ok: true, item: updated });
});

queueRouter.post('/api/posts/:id/mark-posted', (req, res) => {
  const id = Number(req.params.id);
  const item = queueService.getById(id);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  const allowed: Array<typeof item.status> = [
    'needs_manual_post',
    'failed',
    'posting',
    'pending',
  ];
  if (!allowed.includes(item.status)) {
    return res.status(400).json({
      ok: false,
      error: `Cannot mark item with status "${item.status}" as posted.`,
    });
  }
  const updated = queueService.setStatus(id, 'posted', {
    postedAt: nowIso(),
    errorMessage: null,
  });
  logService.info(`User manually confirmed post ${id} as posted.`, {
    previousStatus: item.status,
  });
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
  if (item.status === 'posting') {
    return res.status(409).json({
      ok: false,
      error: `Post ${id} is already in flight.`,
    });
  }
  if (item.status === 'posted') {
    return res.status(409).json({
      ok: false,
      error: `Post ${id} is already posted; not re-sending.`,
    });
  }
  if (item.status !== 'pending' && item.status !== 'failed' && item.status !== 'skipped') {
    return res.status(400).json({
      ok: false,
      error: `Cannot post item in status ${item.status}.`,
    });
  }
  // For failed/skipped, flip back to pending so the atomic claim can grab it.
  if (item.status !== 'pending') {
    queueService.setStatus(id, 'pending', { errorMessage: null });
  }
  try {
    const result = await automationService.postById(id);
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
