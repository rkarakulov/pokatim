import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { HealthResponse } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

async function createController(command: () => Promise<unknown>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [HealthService, { provide: MONGO_DB, useValue: { command } }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('ok, когда БД отвечает, и ответ соответствует контракту', async () => {
    const controller = await createController(() => Promise.resolve({ ok: 1 }));
    const result = await controller.check();
    expect(HealthResponse.parse(result)).toMatchObject({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('degraded, когда БД недоступна', async () => {
    const controller = await createController(() =>
      Promise.reject(new Error('MongoServerSelectionError')),
    );
    await expect(controller.check()).resolves.toMatchObject({ status: 'degraded' });
  });
});
