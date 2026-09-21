import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app/app.module';
import { loadConfig } from './config';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.with(config));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  serveWeb(app, config.webDist);

  // Loopback only: `tailscale serve` is the sole way in. Nest's default of
  // 0.0.0.0 would expose plain HTTP on the tailnet IP, bypassing serve (ADR-014).
  await app.listen(config.port, config.host);
  Logger.log(`listening on http://${config.host}:${config.port} (sha ${config.gitSha})`);
}

/**
 * One origin (ADR-005): the Angular bundle at `/`, the API at `/api`. Any other
 * GET that wants HTML gets index.html so client-side routes survive a reload.
 */
function serveWeb(app: NestExpressApplication, dir: string): void {
  const index = path.join(dir, 'index.html');
  if (!existsSync(index)) {
    Logger.warn(`no web bundle at ${dir} — serving the API only`);
    return;
  }
  app.useStaticAssets(dir, { index: false });
  app.use((req: { method: string; path: string; accepts: (t: string) => string | false }, res: { sendFile: (p: string) => void }, next: () => void) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && req.accepts('html')) return res.sendFile(index);
    next();
  });
}

bootstrap();
