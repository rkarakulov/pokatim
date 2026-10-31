import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import type { ErasureStep } from '@pokatim/contracts';
import type { Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { AchievementErasure } from '../achievements';
import { DeviceErasure } from '../devices';
import { AccountErasure } from '../identity';
import { NotificationErasure } from '../notifications';
import { ProductEventErasure } from '../product-events';
import { ProfileErasure } from '../profile';
import { RideErasure } from '../rides';
import { RouteRideErasure } from '../route-rides';
import { RouteErasure } from '../routes';
import { SocialErasure } from '../social';
import { TicketErasure } from '../tickets';
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
 * каждый повторяем, ретрай задачи повторяет все шаги с начала. Порядок: подпись в райдах пропадает первой (R4), после
 * маршрутов — точки райдов на висячих маршрутах (`ride-starts`, 05c RC-1),
 * устройства — до треков (новых приёмов нет, F4), заезды по маршрутам (`route-rides`, route-rides-01) — после треков, достижения (`achievements`) — после них, билеты (`tickets`) — после них,
 * «Свои» (`social`) и журнал метрик (`product-events`) — после них, уведомления, настройки и токены — после них, письмо и стирание e-mail — последними (A10). Живой аккаунт не
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
    private readonly routeRides: RouteRideErasure,
    private readonly achievements: AchievementErasure,
    private readonly tickets: TicketErasure,
    private readonly social: SocialErasure,
    private readonly productEvents: ProductEventErasure,
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
      return `cancelled=${result.cancelled} left=${result.left} unsigned=${result.unsigned} restarted=${result.restarted} photos=${result.photos}`;
    });
    await this.step(userId, 'routes', run, async () => {
      return `deleted=${await this.routes.erase(userId)}`;
    });
    // после удаления маршрутов: точки райдов на висячих маршрутах (удалённых автором раньше) — центр города (05c, RC-1)
    await this.step(userId, 'ride-starts', run, async () => {
      return `restarted=${await this.rides.resetDanglingStarts(this.clock.now())}`;
    });
    await this.step(userId, 'devices', run, async () => {
      const result = await this.devices.erase(userId, { final: run.final });
      return `revoked=${result.revoked} failed=${result.failed}`;
    });
    await this.step(userId, 'tracks', run, async () => {
      return `deleted=${await this.tracks.erase(userId)}`;
    });
    // после треков: активностей нет — заезды по маршрутам (производные данные удалённого) стираются целиком
    await this.step(userId, 'route-rides', run, async () => {
      return `deleted=${await this.routeRides.erase(userId)}`;
    });
    // после фактов (протоколы остаются псевдонимными, заезды и райды стёрты): выдачи достижений и маркер сверки
    await this.step(userId, 'achievements', run, async () => {
      const result = await this.achievements.erase(userId);
      return `deleted=${result.grants} season=${result.seasonGrants} syncs=${result.syncs}`;
    });
    // регистрации календаря и билеты гонок → `cancelled` (документы псевдонимные, RC-T1 event-tickets)
    await this.step(userId, 'tickets', run, async () => {
      const result = await this.tickets.erase(userId);
      return `registrations=${result.registrations} tickets=${result.tickets}`;
    });
    // связи «Свои» в обе стороны, явки, реакции, код приглашения (ADR-0027 п. 8); затем журнал метрик — единственное
    // исключение из append-only `product_events` (K13)
    await this.step(userId, 'social', run, async () => {
      const result = await this.social.erase(userId);
      return `connections=${result.connections} attendance=${result.attendance} reactions=${result.reactions} codes=${result.codes}`;
    });
    await this.step(userId, 'product-events', run, async () => {
      return `deleted=${await this.productEvents.erase(userId)}`;
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
    name: ErasureStep,
    run: ErasureRun,
    work: () => Promise<string>,
  ): Promise<void> {
    try {
      const summary = await work();
      this.logger.log(`account.erasure user=${userId} step=${name} ${summary}`);
    } catch (error) {
      if (run.final) this.logger.error(`account.erasure_failed user=${userId} step=${name}`);
      // экран сбоев панели (erasure-failures): шаг, код и счётчик; сбой записи не подменяет исходную ошибку
      await this.identity
        .recordFailure(userId, name, error, this.clock.now())
        .catch(() =>
          this.logger.warn(`account.erasure_failure_not_recorded user=${userId} step=${name}`),
        );
      throw error;
    }
  }
}
