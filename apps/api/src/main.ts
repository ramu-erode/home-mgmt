/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 3000;
  // Loopback only: `tailscale serve` is the sole way in. Nest's default of
  // 0.0.0.0 would expose plain HTTP on the tailnet IP, bypassing serve (ADR-014).
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
  Logger.log(`🚀 Application is running on: http://${host}:${port}/${globalPrefix}`);
}

bootstrap();
