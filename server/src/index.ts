import { buildApp, loadEnv } from './app';
import { runMigrations } from './db/migrate';

async function main() {
  const env = loadEnv();
  await runMigrations();

  const app = await buildApp(env);
  await app.listen({ port: env.PORT, host: '127.0.0.1' });
  app.log.info(`XiaoBlog API 已启动，端口 ${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
