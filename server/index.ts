import express from 'express';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { createGeminiClientFromEnv } from './gemini.js';
import type { GeminiClient } from './geminiClient.js';
import { createApiRouter, sendError } from './routes/api.js';
import type { ApiOptions } from './routes/api.js';

export const BODY_LIMIT = '10mb';
export const DEFAULT_PORT = 8787;

export type AppOptions = ApiOptions & {
  /** Extra middleware mounted before /api (used by Mock_Gemini to read x-mock-* headers). */
  middleware?: RequestHandler[];
};

/** App factory. The Gemini layer is injected so tests and Mock_Gemini (MOCK_GEMINI=1) can replace it. */
export function createApp(opts: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: BODY_LIMIT }));
  for (const mw of opts.middleware ?? []) app.use('/api', mw);
  app.use('/api', createApiRouter(opts));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'VALIDATION', message: 'Unknown endpoint.' } });
  });

  // Body-parser errors (oversize, malformed JSON) and anything unexpected. Never leaks error text.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express needs the 4-arg signature
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.too.large') return sendError(res, 'TOO_LARGE');
    if (type === 'entity.parse.failed' || type === 'encoding.unsupported' || type === 'charset.unsupported') {
      return sendError(res, 'VALIDATION');
    }
    console.error('Unhandled server error', err instanceof Error ? err.name : 'error');
    sendError(res, 'AI_FAILED');
  });

  return app;
}

export interface Selection {
  gemini: GeminiClient | null;
  middleware: RequestHandler[];
}

/**
 * Chooses the provider. Mock_Gemini is used only when MOCK_GEMINI=1 and the process was not started with
 * `--production` (the `npm start` script). The mock module is loaded with a dynamic import, so it is never
 * loaded otherwise.
 */
export async function selectGeminiClient(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
): Promise<Selection> {
  if (env.MOCK_GEMINI === '1' && !argv.includes('--production')) {
    const mock = await import('./mockGemini.js');
    return { gemini: mock.createMockGeminiClient(), middleware: [mock.mockRequestMiddleware] };
  }
  return { gemini: createGeminiClientFromEnv(env), middleware: [] };
}

export async function startServer(port = Number(process.env.PORT) || DEFAULT_PORT) {
  const { gemini, middleware } = await selectGeminiClient();
  const mocked = process.env.MOCK_GEMINI === '1' && gemini !== null && middleware.length > 0;
  const app = createApp({ gemini, middleware });
  return app.listen(port, () => {
    console.log(
      `AI proxy listening on http://localhost:${port} (AI ${gemini ? (mocked ? 'enabled: MOCK_GEMINI' : 'enabled') : 'disabled: GEMINI_API_KEY not set'})`,
    );
  });
}
// Run only when executed directly (npm run server), not when imported by tests.
const entry = process.argv[1]?.replace(/\\/g, '/');
if (entry && import.meta.url.endsWith(entry.split('/').slice(-2).join('/'))) void startServer();
