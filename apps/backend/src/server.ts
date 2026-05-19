import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { config } from './config.js';
import { runMigrations } from './db/migrations.js';
import { seedDefaultSettings, resetRuntimeStateOnStartup } from './db/seed.js';
import { extensionGateway } from './websocket/extensionGateway.js';
import { logService } from './services/logService.js';
import { statusRouter } from './routes/status.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { automationRouter } from './routes/automation.routes.js';
import { queueRouter } from './routes/queue.routes.js';
import { logsRouter } from './routes/logs.routes.js';
import { sourcesRouter } from './routes/sources.routes.js';
import { categoriesRouter } from './routes/categories.routes.js';
import { contentSourcesRouter } from './routes/contentSources.routes.js';
import { personalProfileRouter } from './routes/personalProfile.routes.js';
import { ingestRawRouter } from './routes/ingestRaw.routes.js';
import { testPagesRouter } from './routes/testPages.routes.js';

export function createApp() {
  runMigrations();
  seedDefaultSettings();
  resetRuntimeStateOnStartup();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.use(statusRouter);
  app.use(settingsRouter);
  app.use(automationRouter);
  app.use(queueRouter);
  app.use(logsRouter);
  app.use(sourcesRouter);
  app.use(categoriesRouter);
  app.use(contentSourcesRouter);
  app.use(personalProfileRouter);
  app.use(ingestRawRouter);
  app.use(testPagesRouter);

  app.get('/', (_req, res) => {
    res.json({
      name: 'local-browser-automation-bridge backend',
      status: 'ok',
      docs: ['/api/status', '/api/settings', '/api/posts', '/api/logs', '/test/writer', '/test/llm'],
    });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logService.error('Unhandled express error.', { error: err.message, stack: err.stack });
    res.status(500).json({ ok: false, error: err.message });
  });

  return app;
}

export function startServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);
  extensionGateway.attach(server);
  server.listen(config.port, () => {
    logService.info(`Backend listening on http://localhost:${config.port}`);
  });
  return server;
}
