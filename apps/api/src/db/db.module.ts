import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config';
import { createDatabase, DATABASE, type Database } from './database';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => createDatabase(config.databaseUrl),
    },
  ],
  exports: [DATABASE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
