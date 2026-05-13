import { Router } from 'express';
import { settingsService } from '../services/settingsService.js';
import { automationService } from '../services/automationService.js';
import { postScheduler } from '../scheduler/postScheduler.js';
import { batchScheduler } from '../scheduler/batchScheduler.js';
import { logService } from '../services/logService.js';

export const automationRouter = Router();

automationRouter.post('/api/automation/start', async (_req, res) => {
  try {
    postScheduler.start();
    batchScheduler.start();
    res.json({ ok: true, settings: settingsService.get() });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logService.error('Failed to start automation.', { error });
    res.status(500).json({ ok: false, error });
  }
});

automationRouter.post('/api/automation/stop', (_req, res) => {
  postScheduler.stop();
  batchScheduler.stop();
  res.json({ ok: true, settings: settingsService.get() });
});

automationRouter.post('/api/batches/generate', async (_req, res) => {
  try {
    const result = await batchScheduler.generateBatchNow('manual');
    if (result.error) {
      const status = result.skipped === 'in-progress' ? 409 : 502;
      return res.status(status).json({
        ok: false,
        error: result.error,
        sourceUrl: result.sourceUrl,
        skipped: result.skipped,
      });
    }
    res.json({
      ok: true,
      inserted: result.inserted,
      batchId: result.batchId,
      sourceUrl: result.sourceUrl,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logService.error('Generate batch endpoint failed.', { error });
    res.status(500).json({ ok: false, error });
  }
});

automationRouter.post('/api/posts/post-next', async (_req, res) => {
  try {
    const result = await automationService.postNext();
    // After a manual post, recompute the remaining schedule from now so
    // the next post countdown reflects the configured interval, not the
    // stale scheduled_for from the previous timeline.
    if (settingsService.get().isRunning) {
      postScheduler.onScheduleAffectingChange('manual-post-next');
    }
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
