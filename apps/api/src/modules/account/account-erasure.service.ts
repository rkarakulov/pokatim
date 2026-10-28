import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import type { Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { DeviceErasure } from '../devices';
import { AccountErasure } from '../identity';
import { NotificationErasure } from '../notifications';
import { ProfileErasure } from '../profile';
import { RideErasure } from '../rides';
import { RouteErasure } from '../routes';
import { TrackErasure } from '../tracks';
import {
  ACCOUNT_DELETION_SWEEP_JOB,
  type AccountDeletionSweep,
  sweepDeduplicationId,
} from './account.events';
import { ACCOUNT_POLICY } from './account.policy';

export type ErasurePass = 'first' | 'sweep';
export type ErasureOutcome = 'erased' | 'skipped';

export interface ErasureRun {
  pass: ErasurePass;
  /** Последняя попытка задачи BullMQ: провал шага — `account.erasure_failed`, отзыв устройств — `revokeFailed`. */
  final: boolean;
}

/**
 * Фоновая очистка удалённого аккаунта (worker, ADR-0015). Шаги — по порядку, только через порты модулей-владельцев;
 * каждый повторяем, ретрай задачи повторяет все шаги с начала. Порядок: подпись в райдах пропадает первой (R4),
 * устройства — до треков (новых приёмов нет, F4), уведомления, настройки и токены — после треков, письмо и стирание e-mail — последними (A10). Живой аккаунт не
 * трогается (N8). Логи — uid, шаг, исход, счётчики.
 */
@Injectable()
export class AccountErasureService {
  private readonly logger = new Logger(AccountErasureService.name);

  constructor(
    private readonly identity: AccountErasure,
    private readonly profile: ProfileErasure,
    private readonly rides: RideErasure,
    private readonly routes: RouteErasure,
    private readonly devices: DeviceErasure,
    private readonly tracks: TrackErasure,
    private readonly notifications: NotificationErasure,
    @InjectQueue(QUEUE.accountDeletion) private readonly queue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async run(userId: string, run: ErasureRun): Promise<ErasureOutcome> {
    const state = await this.identity.deletionState(userId);
    if (!state?.deletedAt) {
      this.logger.warn(`account.erasure_skipped user=${userId} reason=not_deleted`);
      return 'skipped';
    }
    if (run.pass === 'first') await this.scheduleSweep(userId, ACCOUNT_POLICY.sweepDelayMs);

    await this.step(userId, 'profile', run, async () => {
      const deleted = await this.profile.erase(userId);
      return `deleted=${deleted}`;
    });
    await this.step(userId, 'rides', run, async () => {
      const result = await this.rides.erase(userId, this.clock.now());
      return `cancelled=${result.cancelled} left=${result.left} unsigned=${result.unsigned} restarted=${result.restarted}`;
    });
    await this.step(userId, 'routes', run, async () => {
      return `deleted=${await this.routes.erase(userId)}`;
    });
    await this.step(userId, 'devices', run, async () => {
      const result = await this.devices.erase(userId, { final: run.final });
      return `revoked=${result.revoked} failed=${result.failed}`;
    });
    await this.step(userId, 'tracks', run, async () => {
      return `deleted=${await this.tracks.erase(userId)}`;
    });
    await this.step(userId, 'notifications', run, async () => {
      const result = await this.notifications.erase(userId);
      return `deleted=${result.notifications} settings=${result.settings} tokens=${result.tokens}`;
    });
    await this.step(userId, 'identity', run, async () => {
      const outcome = await this.identity.notifyAndErase(userId, this.clock.now(), {
        abandonEmailAfterMs: ACCOUNT_POLICY.abandonEmailAfterMs,
        emailClaimMs: ACCOUNT_POLICY.emailClaimMs,
      });
      return `outcome=${outcome}`;
    });
    if (run.pass === 'sweep') await this.identity.markSwept(userId, this.clock.now());
    this.logger.log(`account.erasure_done user=${userId} pass=${run.pass}`);
    return 'erased';
  }

  /** Регламент: повторный проход удалённым раньше `resumeAfterMs` без завершённой очистки. */
  async resume(): Promise<number> {
    const deletedBefore = new Date(this.clock.now().getTime() - ACCOUNT_POLICY.resumeAfterMs);
    const pending = await this.identity.pendingSweeps(deletedBefore, ACCOUNT_POLICY.resumeBatch);
    for (const userId of pending) await this.scheduleSweep(userId, 0);
    if (pending.length > 0) this.logger.log(`account.erasure_resume count=${pending.length}`);
    return pending.length;
  }

  private async scheduleSweep(userId: string, delayMs: number): Promise<void> {
    const data: AccountDeletionSweep = { userId };
    await this.queue.add(ACCOUNT_DELETION_SWEEP_JOB, data, {
      deduplication: { id: sweepDeduplicationId(userId) },
      ...(delayMs > 0 ? { delay: delayMs } : {}),
    });
  }

  private async step(
    userId: string,
    name: string,
    run: ErasureRun,
    work: () => Promise<string>,
  ): Promise<void> {
    try {
      const summary = await work();
      this.logger.log(`account.erasure user=${userId} step=${name} ${summary}`);
    } catch (error) {
      if (run.final) this.logger.error(`account.erasure_failed user=${userId} step=${name}`);
      throw error;
    }
  }
}
