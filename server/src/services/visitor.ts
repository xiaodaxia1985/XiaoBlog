import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COOKIE_NAME = 'xb_vid';

/**
 * 访客标识：优先使用服务端下发的 HttpOnly UUID Cookie；缺失时用 IP+UA+盐值派生哈希。
 * 只存不可逆哈希，不收集真实姓名、邮箱等身份信息。
 */
function deriveHash(value: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(value).digest('hex');
}

export function resolveVisitor(
  req: FastifyRequest,
  reply: FastifyReply,
  salt: string,
  secure: boolean
): string {
  const cookies = req.cookies ?? {};
  let vid: string | undefined = cookies[COOKIE_NAME];

  if (!vid) {
    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    const ua = String(req.headers['user-agent'] ?? '');
    vid = crypto.randomUUID();
    reply.setCookie(COOKIE_NAME, vid, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    // 回写哈希：新 Cookie 与派生值都纳入盐值哈希，避免直接暴露 UUID。
    return deriveHash(`${vid}|${ip}|${ua}`, salt);
  }

  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const ua = String(req.headers['user-agent'] ?? '');
  return deriveHash(`${vid}|${ip}|${ua}`, salt);
}
