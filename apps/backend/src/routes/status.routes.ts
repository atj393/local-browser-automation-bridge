import { Router } from 'express';
import type { StatusResponse } from '@lbab/shared';
import { settingsService } from '../services/settingsService.js';
import { queueService } from '../services/queueService.js';
import { logService } from '../services/logService.js';
import { extensionGateway } from '../websocket/extensionGateway.js';

export const statusRouter = Router();

statusRouter.get('/api/status', (_req, res) => {
  const settings = settingsService.get();
  const counts = queueService.counts();
  const lastLog = logService.last();
  const body: StatusResponse = {
    isRunning: settings.isRunning,
    writerConnected: extensionGateway.hasWriter(),
    readerConnected: extensionGateway.hasReader(),
    extensionConnected: extensionGateway.isConnected(),
    pendingCount: counts.pending,
    scheduledCount: counts.scheduled,
    postingCount: counts.posting,
    postedCount: counts.posted,
    failedCount: counts.failed,
    skippedCount: counts.skipped,
    nextRunAt: settings.nextRunAt,
    lastLog,
  };
  res.json(body);
});
