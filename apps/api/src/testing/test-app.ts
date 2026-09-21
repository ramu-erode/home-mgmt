import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { inject } from 'vitest';
import { DEVICE_HEADER, PROTOCOL_HEADER, PROTOCOL_VERSION } from '@home-mgmt/shared';
import { AppModule } from '../app/app.module';
import type { AppConfig } from '../config';

export const hasDatabase = inject('testDatabase') !== null;

/** A fresh clone of the migrated template, dropped by the returned function. */
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const ctx = inject('testDatabase');
  if (!ctx) throw new Error('no test database — DATABASE_URL is unset');
  const name = `homemgmt_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await admin(ctx.adminUrl, `CREATE DATABASE ${name} TEMPLATE ${ctx.template}`);
  const url = new URL(ctx.adminUrl);
  url.pathname = `/${name}`;
  return { url: url.toString(), drop: () => admin(ctx.adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`) };
}

async function admin(url: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export const LOGIN = 'household@example.com';

export interface TestApp {
  app: INestApplication;
  /** fetch against the running app, with tailnet identity and protocol headers set. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted on, not trusted
  call: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

export async function startApp(databaseUrl: string, overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const config: AppConfig = {
    databaseUrl,
    host: '127.0.0.1',
    port: 0,
    production: false,
    allowedLogin: LOGIN,
    householdTimeZone: 'Asia/Kolkata',
    fixedToday: '2026-09-21',
    webDist: '/nonexistent',
    gitSha: 'test-sha',
    backupStampFile: null,
    horizonRoll: false,
    ...overrides,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.with(config)] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();

  const call: TestApp['call'] = async (path, init = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        'tailscale-user-login': LOGIN,
        [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
        [DEVICE_HEADER]: DEVICE,
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { app, call, close: () => app.close() };
}

export const DEVICE = '0d0d0d0d-0000-4000-8000-000000000001';
