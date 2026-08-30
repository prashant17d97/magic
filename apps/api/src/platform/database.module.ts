import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { type Database, createDatabase } from '@magic/db';
import { CONFIG, type ApiConfig, loadConfig } from '../config.js';

export const DATABASE = Symbol('MAGIC_DATABASE');
export const DATABASE_HANDLE = Symbol('MAGIC_DATABASE_HANDLE');

type Handle = ReturnType<typeof createDatabase>;

/**
 * One pooled connection set for the process, created from validated configuration. The pool is
 * capped and carries a statement timeout so a single runaway analytical query cannot hold a
 * connection open and starve the request path.
 */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: DATABASE_HANDLE,
      inject: [CONFIG],
      useFactory: (config: ApiConfig): Handle =>
        createDatabase({
          url: config.DATABASE_URL,
          poolMax: config.DATABASE_POOL_MAX,
          statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
          applicationName: 'magic-api',
        }),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_HANDLE],
      useFactory: (handle: Handle): Database => handle.db,
    },
  ],
  exports: [CONFIG, DATABASE, DATABASE_HANDLE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: Handle) {}

  async onModuleDestroy(): Promise<void> {
    await this.handle.close();
  }
}
