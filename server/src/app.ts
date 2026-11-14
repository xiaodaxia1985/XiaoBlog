import Fastify, { type FastifyInstance } from 'fastify';
import cookiePlugin from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { loadEnv, type Env } from './config/env';
import { SlugGuard } from './services/slug-guard';
import { registerStatsRoutes } from './routes/stats';
import { registerEngagementRoutes } from './routes/engagement';

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: true });

  // 必须 await：插件（含限流的 onRoute 钩子）加载完成后再注册路由，
  // 否则路由先挂载，全局限流钩子绑不到任何路由上。
  await app.register(cookiePlugin);

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator: (req) => {
      const vid = req.cookies?.['xb_vid'] ?? '';
      return `${vid}:${req.ip ?? ''}`;
    },
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
