// ABOUTME: Express server with Vite integration
// ABOUTME: Loads one validated GEWUZAOJING environment before opening a port

import { createServer, type Server } from 'node:http';

import express, { type Express } from 'express';

import {
  loadEchoLlmConfig,
  type EchoLlmConfig,
} from './config/llm-config';
import { registerChatRoutes } from './routes/chat';
import router from './routes/index';
import { registerQuestRoutes } from './routes/quest-generate';
import { setupVite } from './vite';

export interface EchoServerDependencies {
  fetch?: typeof fetch;
}

export async function createEchoApp(
  config: EchoLlmConfig,
  dependencies: EchoServerDependencies = {},
): Promise<Express> {
  const app = express();
  const isDev = process.env.COZE_PROJECT_ENV !== 'PROD';
  const engineBase = (process.env.NARRATIVE_ENGINE_URL || 'http://127.0.0.1:8050')
    .replace(/\/+$/, '');

  if (isDev) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const elapsed = Date.now() - start;
        console.log(`${req.method} ${req.url} - ${elapsed}ms`);
      });
      next();
    });
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 前端运行时配置：引擎端口由 叙事引擎 启动时注入，换端口不需要重新构建
  app.get('/echo-runtime-config.js', (_req, res) => {
    res
      .type('application/javascript')
      .set('Cache-Control', 'no-store')
      .send(`window.__ECHO_RUNTIME__=${JSON.stringify({ engineBase })};`);
  });

  app.use(router);

  const providerDependencies = dependencies.fetch === undefined
    ? undefined
    : { fetch: dependencies.fetch };
  registerChatRoutes(
    app,
    { connection: config.connection, model: config.chatModel },
    { ...providerDependencies, engineBase },
  );
  registerQuestRoutes(
    app,
    { connection: config.connection, model: config.questModel },
    providerDependencies,
  );

  await setupVite(app);

  app.use((err: Error, _req: express.Request, res: express.Response) => {
    console.error('Server error:', err);
    const status = 'status' in err
      ? (err as { status?: number }).status ?? 500
      : 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

export async function startServer(): Promise<Server> {
  const config = loadEchoLlmConfig();
  const app = await createEchoApp(config);
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const isDev = process.env.COZE_PROJECT_ENV !== 'PROD';
  console.log(`\n✨ Echo server running at http://${config.host}:${config.port}`);
  console.log(`📝 Environment: ${isDev ? 'development' : 'production'}\n`);
  return server;
}

if (require.main === module) {
  void startServer().catch(() => {
    console.error('Failed to start Echo server');
    process.exitCode = 1;
  });
}
