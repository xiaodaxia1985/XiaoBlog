import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { VoteRepo } from '../storage/votes';
import { StatsRepo } from '../storage/stats';
import { resolveVisitor } from '../services/visitor';
import type { SlugGuard } from '../services/slug-guard';
import type { Env } from '../config/env';

const paramsSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) });

export function registerStatsRoutes(app: FastifyInstance, deps: { slugGuard: SlugGuard; env: Env }) {
  const votes = new VoteRepo();
  const stats = new StatsRepo();
  const secureCookie = deps.env.SITE_URL.startsWith('https:');

  app.get('/api/stats/:slug', async (req, reply) => {
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_slug' });
    const { slug } = parsed.data;

    if (!deps.slugGuard.isAllowed(slug)) return reply.code(404).send({ error: 'not_found' });

    const visitor = resolveVisitor(req, reply, deps.env.VISITOR_SALT, secureCookie);
    const [counter, vote] = await Promise.all([
      stats.get(slug),
      votes.getVote(slug, visitor),
    ]);

    return {
      slug,
      views: counter.views,
      likes: counter.likes,
      dislikes: counter.dislikes,
      voted: vote?.choice ?? null,
    };
  });
}
