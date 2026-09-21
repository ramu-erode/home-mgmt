import path from 'node:path';

/**
 * Process configuration, read once from the environment. Injected as CONFIG so
 * tests can replace it wholesale.
 */
export interface AppConfig {
  databaseUrl: string;
  host: string;
  port: number;
  production: boolean;
  /**
   * The household Tailscale login (ADR-014). Requests whose
   * `Tailscale-User-Login` differs are refused. Unset in production refuses
   * everything; unset in development allows everything, with a warning.
   */
  allowedLogin: string | null;
  /** "Today" is the household's, not the machine's (ADR-013). */
  householdTimeZone: string;
  /** Fixed "today" for tests; never set in production. */
  fixedToday: string | null;
  /** Built Angular bundle to serve at `/` (ADR-005); skipped if absent. */
  webDist: string;
  gitSha: string;
  /** Written by the backup script after each successful write to the drive (ADR-015). */
  backupStampFile: string | null;
  /** Daily horizon roll; off in tests. */
  horizonRoll: boolean;
}

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return {
    databaseUrl,
    // Loopback only: `tailscale serve` is the sole way in (ADR-014).
    host: env['HOST'] || '127.0.0.1',
    port: Number(env['PORT'] || 3000),
    production: env['NODE_ENV'] === 'production',
    allowedLogin: env['TAILSCALE_ALLOWED_LOGIN'] || null,
    householdTimeZone: env['HOUSEHOLD_TZ'] || 'Asia/Kolkata',
    fixedToday: env['FIXED_TODAY'] || null,
    // dist/apps/api/main.js → dist/apps/web/browser
    webDist: env['WEB_DIST'] || path.resolve(__dirname, '../web/browser'),
    gitSha: env['GIT_SHA'] || 'dev',
    backupStampFile: env['BACKUP_STAMP_FILE'] || null,
    horizonRoll: env['HORIZON_ROLL'] !== 'off',
  };
}
