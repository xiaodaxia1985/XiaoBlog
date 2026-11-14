import { z } from 'zod';

/**
 * 服务端环境变量校验。凭证只存在于 ECS 环境变量，不进入前端静态产物。
 * 本地缺省值仅用于类型与开发提示，生产必须显式配置。
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** 站点对外原始地址，用于 Origin/Referer 校验，例如 https://xiaomaker.top */
  SITE_URL: z.string().url(),
  /** 访客标识哈希盐值：用于把 Cookie/IP 派生为不可逆哈希，不存身份信息。 */
  VISITOR_SALT: z.string().min(8),
  /** 白名单 slug 清单文件路径（由静态站构建产物生成）。 */
  SLUG_WHITELIST_FILE: z.string().min(1).default('../public/data/slugs.json'),
  PORT: z.coerce.number().int().positive().default(8787),
  /** 单访客每分钟请求上限（按 Cookie + IP 限流）。 */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`环境变量校验失败：${issues}`);
  }
  return parsed.data;
}
