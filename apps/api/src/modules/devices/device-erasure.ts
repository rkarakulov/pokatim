import { Injectable, Logger } from '@nestjs/common';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';

import { DeviceAudit } from './device-audit';
import { type Attempt, DeviceRevocation } from './device-revocation';
import { DevicesRepository } from './devices.repository';

/**
 * Порт стирания устройств удалённого аккаунта (модуль `account`, ADR-0015, A8): каждое живое подключение — под замком
 * pull в `disconnecting` с записью журнала `disconnected` (`account_deleted`), отзыв в агрегаторе (общий
 * `DeviceRevocation`), затем удаление `device_*` пользователя, кроме журнала (A9). Пользователь агрегатора остаётся —
 * ручной шаг runbook. Вызывается до шага треков: после него новых приёмов нет (F4). Повторяемо.
 */
@Injectable()
export class DeviceErasure {
  private readonly logger = new Logger(DeviceErasure.name);

  constructor(
    private readonly repository: DevicesRepository,
    private readonly audit: DeviceAudit,
    private readonly transactions: MongoTransactions,
    private readonly revocation: DeviceRevocation,
  ) {}

  async erase(userId: string, attempt: Attempt): Promise<{ revoked: number; failed: number }> {
    let revoked = 0;
    let failed = 0;
    for (const live of await this.repository.liveConnectionsOf(userId)) {
      const outcome = await this.revocation.locked(live._id, attempt, async () => {
        await this.transactions.run(async (session) => {
          const updated = await this.repository.requestDisconnect(session, live._id, [
            'pending',
            'active',
          ]);
          if (updated) {
            await this.audit.append(session, {
              userId,
              provider: live.provider,
              connectionId: live._id,
              action: 'disconnected',
              reason: 'account_deleted',
            });
          }
        });
        const connection = await this.repository.findConnection(live._id);
        if (connection?.status !== 'disconnecting') return 'skipped';
        return this.revocation.revokeDisconnecting(connection, 'account_deleted', attempt);
      });
      if (outcome === 'revoked') revoked += 1;
      if (outcome === 'revoke_failed') failed += 1;
    }
    await this.repository.deleteUserData(userId);
    this.logger.log(`devices.erased user=${userId} revoked=${revoked} failed=${failed}`);
    return { revoked, failed };
  }
}
