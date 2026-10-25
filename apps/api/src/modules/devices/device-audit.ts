import { Inject, Injectable } from '@nestjs/common';
import type { DeviceProvider } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import type { DeviceAuditDoc } from './devices.collection';
import { DevicesRepository } from './devices.repository';

export interface DeviceAuditRecord {
  userId: string;
  provider: DeviceProvider;
  connectionId: string;
  action: DeviceAuditDoc['action'];
  reason?: string | null;
}

/**
 * Журнал подключений (§8.3 п. 6) — append-only: только вставка в транзакции действия (тест-сторож
 * `device-audit.test.ts`), без идентификаторов агрегатора.
 */
@Injectable()
export class DeviceAudit {
  constructor(
    private readonly repository: DevicesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async append(session: DbSession | undefined, record: DeviceAuditRecord): Promise<void> {
    await this.repository.insertAudit(session, {
      _id: uuidv7(),
      userId: record.userId,
      provider: record.provider,
      connectionId: record.connectionId,
      action: record.action,
      reason: record.reason ?? null,
      at: this.clock.now(),
    });
  }
}
