import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { VoteRepo } from '../storage/votes';
import { StatsRepo } from '../storage/stats';
import { ViewRepo } from '../storage/views';
import { resolveVisitor } from '../services/visitor';
import { isSameOrigin } from '../services/security';
import type { SlugGuard } from '../services/slug-guard';
import type { Env } from '../config/env';

const paramsSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) });
const voteBodySchema = z.object({ choice: z.enum(['like', 'dislike']) });

export function registerEngagementRoutes(
  app: FastifyInstance,
  deps: { slugGuard: SlugGuard; env: Env }
) {
  const votes = new VoteRepo();
  const stats = new StatsRepo();
  const views = new ViewRepo();
  const secureCookie = deps.env.SITE_URL.startsWith('https:');

  /** 统一前置校验：同源 + slug 白名单。 */
  function precheck(req: FastifyRequest, reply: FastifyReply) {
    if (!isSameOrigin(req, deps.env.SITE_URL)) {
      reply.code(403).send({ error: 'origin_forbidden' });
      return false;
    }
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_slug' });
      return false;
    }
    if (!deps.slugGuard.isAllowed(parsed.data.slug)) {
      reply.code(404).send({ error: 'not_found' });
      return false;
    }
    return true;
  }

  app.post('/api/vote/:slug', async (req, reply) => {
    if (!precheck(req, reply)) return;
    const { slug } = paramsSchema.parse(req.params);
    const body = voteBodySchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_choice' });

    const visitor = resolveVisitor(req, reply, deps.env.VISITOR_SALT, secureCookie);
    const existing = await votes.getVote(slug, visitor);

    // 再次点击同一项 → 取消；否则改票/投票。
    if (existing && existing.choice === body.data.choice) {
      await votes.removeVote(slug, visitor);
    } else {
      await votes.upsertVote(slug, visitor, body.data.choice);
    }

    const counts = await votes.countsBySlug(slug);
    await stats.recomputeFromVotes(slug, counts);
    const after = await votes.getVote(slug, visitor);

    return {
      slug,
      likes: counts.likes,
      dislikes: counts.dislikes,
      voted: after?.choice ?? null,
    };
  });

  app.post('/api/view/:slug', async (req, reply) => {
    if (!precheck(req, reply)) return;
    const { slug } = paramsSchema.parse(req.params);
    const visitor = resolveVisitor(req, reply, deps.env.VISITOR_SALT, secureCookie);

    const firstToday = !(await views.hasViewedToday(slug, visitor));
    if (firstToday) {
      await views.markViewed(slug, visitor);
      await stats.recordView(slug);
    }

    const counter = await stats.get(slug);
    return { slug, views: counter.views, counted: firstToday };
  });
}
