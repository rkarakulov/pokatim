import { Inject, Injectable } from '@nestjs/common';
import type { HealthResponse } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

@Injectable()
export class HealthService {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  async check(): Promise<HealthResponse> {
    const database = await this.db
      .command({ ping: 1 })
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      version: process.env.APP_VERSION ?? 'dev',
      checks: { database },
    };
  }
}
