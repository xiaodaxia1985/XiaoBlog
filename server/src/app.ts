import Fastify, { type FastifyInstance } from 'fastify';
import cookiePlugin from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { loadEnv, type Env } from './config/env';
import { SlugGuard } from './services/slug-guard';
import { registerStatsRoutes } from './routes/stats';
import { registerEngagementRoutes } from './routes/engagement';

export function buildApp(env: Env): FastifyInstance {
  const app = Fastify({ logger: true, trustProxy: true });

  app.register(cookiePlugin);

  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator: (req) => {
      const vid = req.cookies?.['xb_vid'] ?? '';
      return `${vid}:${req.ip ?? ''}`;
    },
    prefix: '/api',
  });

  const slugGuard = new SlugGuard(env.SLUG_WHITELIST_FILE);
  const deps = { slugGuard, env };

  registerStatsRoutes(app, deps);
  registerEngagementRoutes(app, deps);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    app.log.error(err);
    reply.code(err.statusCode ?? 500).send({ error: 'internal_error' });
  });

  return app;
}

export { loadEnv };
