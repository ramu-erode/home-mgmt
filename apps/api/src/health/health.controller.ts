import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import { Public } from '../auth/tailnet.guard';
import { CONFIG, type AppConfig } from '../config';
import { DATABASE, type Database } from '../db/database';
import { databaseStatus } from '../db/health-store';

const BACKUP_STALE_MS = 3 * 24 * 60 * 60 * 1000;

export interface HealthResponse {
  sha: string;
  migration: string | null;
  database: 'ok';
  /** Last successful write of a backup to the USB drive (ADR-015), or null if never / not configured. */
  lastBackupAt: string | null;
  /** The app shows a banner when true. */
  backupStale: boolean;
}

/**
 * Public: the deploy script calls it on loopback after a restart and rolls back
 * unless it answers with the new SHA (ADR-017). It exposes no household data.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Public()
  @Get()
  async get(): Promise<HealthResponse> {
    const db = await databaseStatus(this.db);
    if (!db.reachable) throw new ServiceUnavailableException('database unreachable');
    const lastBackupAt = await this.lastBackup();
    return {
      sha: this.config.gitSha,
      migration: db.migration,
      database: 'ok',
      lastBackupAt,
      backupStale: !lastBackupAt || Date.now() - Date.parse(lastBackupAt) > BACKUP_STALE_MS,
    };
  }

  /** The backup script touches this file after writing to the drive; its mtime is the timestamp. */
  private async lastBackup(): Promise<string | null> {
    if (!this.config.backupStampFile) return null;
    try {
      return (await stat(this.config.backupStampFile)).mtime.toISOString();
    } catch {
      return null;
    }
  }
}
