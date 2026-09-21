import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TailnetGuard } from '../auth/tailnet.guard';
import { CONFIG, loadConfig, type AppConfig } from '../config';
import { DbModule } from '../db/db.module';
import { ForecastController } from '../forecast/forecast.controller';
import { HealthController } from '../health/health.controller';
import { HouseholdTime } from '../household-time';
import { HorizonRollService } from '../regeneration/horizon-roll.service';
import { RegenerationService } from '../regeneration/regeneration.service';
import { SyncController } from '../sync/sync.controller';
import { SyncService } from '../sync/sync.service';

@Module({})
export class AppModule {
  /** Configuration is passed in so tests can supply their own. */
  static with(config: AppConfig = loadConfig()): DynamicModule {
    const configModule: DynamicModule = {
      module: class ConfigModule {},
      global: true,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
    return {
      module: AppModule,
      imports: [configModule, DbModule],
      controllers: [SyncController, ForecastController, HealthController],
      providers: [
        { provide: APP_GUARD, useClass: TailnetGuard },
        HouseholdTime,
        RegenerationService,
        HorizonRollService,
        SyncService,
      ],
    };
  }
}
