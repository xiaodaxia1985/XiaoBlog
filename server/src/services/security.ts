import type { FastifyRequest } from 'fastify';

/**
 * Origin/Referer 校验：浏览器请求带 Origin；与站点原始地址同源才放行。
 * 无 Origin 的请求（服务端渲染、脚本）由调用方按需放行，不在此放宽浏览器场景。
 */
export function isSameOrigin(req: FastifyRequest, siteUrl: string): boolean {
  const allowed = new URL(siteUrl);
  const origin = req.headers.origin;
  if (origin) {
    const o = new URL(origin);
    return o.protocol === allowed.protocol && o.host === allowed.host;
  }
  const referer = req.headers.referer;
  if (referer) {
    const r = new URL(referer);
    return r.protocol === allowed.protocol && r.host === allowed.host;
  }
  return false;
}
