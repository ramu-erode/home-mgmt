import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RegenerationService } from '../regeneration/regeneration.service';
import { createTestDatabase, hasDatabase, startApp, type TestApp } from '../testing/test-app';

/**
 * The golden forecast again, end to end: the synthetic household is seeded,
 * the server materialises it (ADR-009), and GET /api/forecast must match the
 * same hand-calculated figures the engine's own golden test uses.
 */
const suite = hasDatabase ? describe : describe.skip;
const root = path.resolve(import.meta.dirname, '../../../..');
const expected = JSON.parse(readFileSync(path.join(root, 'libs/core/src/testing/synthetic-household.expected.json'), 'utf8'));

suite('forecast (integration)', () => {
  let t: TestApp;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const test = await createTestDatabase();
    drop = test.drop;
    execFileSync(process.execPath, [path.join(root, 'apps/api/src/db/seed.mts')], { env: { ...process.env, DATABASE_URL: test.url }, stdio: 'pipe' });
    t = await startApp(test.url);
    await t.app.get(RegenerationService).rollHorizon();
  });
  afterAll(async () => {
    await t?.close();
    await drop?.();
  });

  it('matches the hand-calculated 18 months', async () => {
    const r = await t.call('/forecast');
    expect(r.status).toBe(200);
    expect(r.body.today).toBe('2026-09-21');
    const months = r.body.forecast.months.map(({ month, outgoings, incomeAll, balanceAll }: Record<string, string>) => ({ month, outgoings, incomeAll, balanceAll }));
    expect(months).toEqual(expected.months);
  });

  it('matches the hand-calculated steady state', async () => {
    expect((await t.call('/forecast')).body.sinkingFund.steadyState).toBe(expected.steadyState);
  });

  it('is refused without the tailnet identity', async () => {
    expect((await t.call('/forecast', { headers: { 'tailscale-user-login': '' } })).status).toBe(403);
  });

  it('bounds the horizon', async () => {
    expect((await t.call('/forecast?months=99')).status).toBe(400);
  });
});
