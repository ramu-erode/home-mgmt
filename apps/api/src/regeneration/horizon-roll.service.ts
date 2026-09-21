import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config';
import { HouseholdTime } from '../household-time';
import { RegenerationService } from './regeneration.service';

const HOUR = 60 * 60 * 1000;

/**
 * The nightly horizon roll, done as "whenever the household date changes":
 * on boot, then checked hourly. A Mac that was off overnight — FileVault
 * waiting for an unlock (ADR-015) — catches up the moment it is back, which a
 * fixed 02:00 schedule would miss.
 */
@Injectable()
export class HorizonRollService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(HorizonRollService.name);
  private timer: NodeJS.Timeout | null = null;
  private rolledFor: string | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
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

  private async tick(): Promise<void> {
    const today = this.time.today();
    if (today === this.rolledFor) return;
    try {
      await this.regeneration.rollHorizon();
      this.rolledFor = today;
    } catch (e) {
      // Leave rolledFor unset so the next tick retries.
      this.log.error(`horizon roll failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
