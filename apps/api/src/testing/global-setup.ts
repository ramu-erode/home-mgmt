import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Builds one migrated template database per test run. Each integration spec
 * clones it (`createTestDatabase`), so specs never see each other's rows and
 * the dev database is never touched. Skipped when DATABASE_URL is unset —
 * integration specs then skip themselves.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: { adminUrl: string; template: string } | null;
  }
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const adminUrl = process.env['DATABASE_URL'];
  if (!adminUrl) {
    project.provide('testDatabase', null);
    return;
  }
  const template = `homemgmt_test_tpl_${process.pid}`;
  await admin(adminUrl, [`DROP DATABASE IF EXISTS ${template}`, `CREATE DATABASE ${template}`]);

  const url = new URL(adminUrl);
  url.pathname = `/${template}`;
  const migrate = path.resolve(import.meta.dirname, '../db/migrate.mts');
  execFileSync(process.execPath, [migrate], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });

  project.provide('testDatabase', { adminUrl, template });
  return () => admin(adminUrl, [`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`]);
}

async function admin(url: string, statements: string[]): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const s of statements) await client.query(s);
  } finally {
    await client.end();
  }
}
