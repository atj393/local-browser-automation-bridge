import { Router } from 'express';
import path from 'node:path';
import { config } from '../config.js';

export const testPagesRouter = Router();

testPagesRouter.get('/test/writer', (_req, res) => {
  res.sendFile(path.join(config.testPagesDir, 'writer.html'));
});

testPagesRouter.get('/test/llm', (_req, res) => {
  res.sendFile(path.join(config.testPagesDir, 'llm.html'));
});
