import { Router } from 'express';
import { logService } from '../services/logService.js';

export const logsRouter = Router();

logsRouter.get('/api/logs', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 200), 1), 1000);
  res.json({ items: logService.list(limit) });
});

logsRouter.delete('/api/logs', (_req, res) => {
  logService.clear();
  res.json({ ok: true });
});
