import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config';
import { DATABASE, type Database } from '../db/database';
import { purgeTombstones, type PurgeResult } from '../db/purge-store';
import { HouseholdTime } from '../household-time';
import { RegenerationService } from './regeneration.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Comfortably longer than any phone stays offline (ADR-007). */
export const TOMBSTONE_RETENTION_DAYS = 180;

/**
 * The daily jobs, run "whenever the household date changes": on boot, then
 * checked hourly. A Mac that was off overnight — FileVault waiting for an
 * unlock (ADR-015) — catches up the moment it is back, which a fixed 02:00
 * schedule would miss.
 *
 * 1. Horizon roll — extend every flow to the current 18-month horizon.
 * 2. Tombstone purge — hard-delete tombstones older than 180 days. ADR-007
 *    says monthly; daily removes nothing extra (the cutoff decides) and keeps
 *    one schedule.
 */
@Injectable()
export class DailyJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(DailyJobsService.name);
  private timer: NodeJS.Timeout | null = null;
  private ranFor: string | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly time: HouseholdTime,
    private readonly regeneration: RegenerationService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.horizonRoll) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), HOUR);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async purge(now = new Date()): Promise<PurgeResult> {
    const result = await purgeTombstones(this.db, new Date(now.getTime() - TOMBSTONE_RETENTION_DAYS * DAY));
    const total = Object.values(result.deleted).reduce((a, b) => a + b, 0);
    if (total) this.log.log(`purged ${total} tombstones ${JSON.stringify(result.deleted)}; min retained version ${result.minRetainedVersion}`);
    return result;
  }

  private async tick(): Promise<void> {
    const today = this.time.today();
    if (today === this.ranFor) return;
    try {
      await this.regeneration.rollHorizon();
      await this.purge();
      this.ranFor = today;
    } catch (e) {
      // Leave ranFor unset so the next tick retries.
      this.log.error(`daily jobs failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
