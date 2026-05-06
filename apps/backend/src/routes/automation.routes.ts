import { Router } from 'express';
import { settingsService } from '../services/settingsService.js';
import { promptService } from '../services/promptService.js';
import { automationService } from '../services/automationService.js';
import { queueService } from '../services/queueService.js';
import { postScheduler } from '../scheduler/postScheduler.js';
import { logService } from '../services/logService.js';

export const automationRouter = Router();

automationRouter.post('/api/automation/start', async (_req, res) => {
  try {
    await postScheduler.start();
    res.json({ ok: true, settings: settingsService.get() });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logService.error('Failed to start automation.', { error });
    res.status(500).json({ ok: false, error });
  }
});

automationRouter.post('/api/automation/stop', (_req, res) => {
  postScheduler.stop();
  res.json({ ok: true, settings: settingsService.get() });
});

automationRouter.post('/api/batches/generate', async (_req, res) => {
  try {
    const result = await promptService.generateAndStoreBatch();
    if (result.error) {
      return res.status(502).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, inserted: result.inserted, batchId: result.batchId });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logService.error('Generate batch endpoint failed.', { error });
    res.status(500).json({ ok: false, error });
  }
});

automationRouter.post('/api/posts/post-next', async (_req, res) => {
  try {
    const result = await automationService.postNext();
    if (result.noPending) {
      return res.status(404).json({ ok: false, error: 'No pending items.' });
    }
    if (!result.success) {
      return res.status(502).json({ ok: false, error: result.error, postId: result.postId });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logService.error('post-next endpoint failed.', { error });
    res.status(500).json({ ok: false, error });
  }
});
