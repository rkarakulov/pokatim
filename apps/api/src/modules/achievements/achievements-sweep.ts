import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import type { Queue } from 'bullmq';

import type { ChangedCursor, RiderChanges } from '../../changed-since';
import { QUEUE } from '../../queues';
import { IdentityAccounts } from '../identity';
import { RIDER_RESULTS, type RiderResults } from '../results';
import { RIDER_RIDES, type RiderRides } from '../rides';
import { RIDER_ROUTE_RIDES, type RiderRouteRides } from '../route-rides';
import { RIDER_SEASON_STANDINGS, type RiderSeasonStandings } from '../standings';
import {
  ACHIEVEMENTS_SYNC_SOURCES,
  type AchievementsSyncSource,
  AchievementsSyncState,
} from './achievements-sync.state';
import { ACHIEVEMENTS_SERVER_SYNC } from './achievements.policy';
import { AchievementsRepository } from './achievements.repository';

export const ACHIEVEMENTS_SWEEP_JOB = 'achievements.sweep';
export const ACHIEVEMENTS_RIDER_JOB = 'achievements.rider';

/** jobId задачи райдера (без `:` — BullMQ): дубли внутри прогона схлопываются, следующий прогон ставит заново. */
export const achievementsRiderJobId = (userId: string, runAt: Date) =>
  `ach-rider-${userId}-${runAt.getTime()}`;

/** Опции задачи райдера: ретраи с экспоненциальной паузой; провалы — в failed-наборе (ограниченно). */
export const ACHIEVEMENTS_RIDER_JOB_OPTIONS = {
  attempts: ACHIEVEMENTS_SERVER_SYNC.riderAttempts,
  backoff: { type: 'exponential', delay: ACHIEVEMENTS_SERVER_SYNC.riderBackoffMs },
  removeOnComplete: true,
  removeOnFail: { count: 1_000 },
} as const;

/** Итог прогона: `busy` — шёл другой прогон (ничего не читали). */
export interface AchievementsSweepRun {
  busy: boolean;
  /** райдеров по источникам (до фильтров) */
  read: Record<AchievementsSyncSource, number>;
  enqueued: number;
  failedSources: AchievementsSyncSource[];
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

/**
 * Регламент серверной сверки достижений (`achievements.sweep`, achievements-push N2, ADR-0020 «Дополнение: push»):
 * без событий outbox (fan-out нет, у «заезд засчитан» и «сезон завершился» событий нет) — по курсору каждого источника
 * страница строк окна `(курсор, until]` портов владельцев (`until = now − settleMs`, райды — `now − rideSettleMs`,
 * RC-P1) → райдеры → только живые аккаунты (`IdentityAccounts.liveUserIds`, RC-P7) ∩ с маркером первой сверки
 * (`syncedAmong`, P2/AC5) → задачи `achievements.rider` → курсоры сдвигаются **после** постановки. Полного скана нет;
 * полная страница — продолжение следующим прогоном. Нет курсора (первый запуск, потеря Redis) — окно с
 * `until − lostCursorMs` (RC-P9: старые факты не будят push). Сбой источника — лог, его курсор стоит, остальные идут,
 * в конце — исключение (failed-набор). Один прогон за раз — замок-аренда Redis: продление своим токеном перед каждым
 * шагом, курсоры пишет только владелец (атомарно с проверкой токена); аренда потеряна — прогон прекращается с
 * `achievements.sweep_lease_lost` без записи курсоров (окно повторит следующий прогон — дубли, не пропуски).
 */
@Injectable()
export class AchievementsSweep {
  private readonly logger = new Logger(AchievementsSweep.name);

  constructor(
    @Inject(RIDER_RESULTS) private readonly results: RiderResults,
    @Inject(RIDER_RIDES) private readonly rides: RiderRides,
    @Inject(RIDER_ROUTE_RIDES) private readonly routeRides: RiderRouteRides,
    @Inject(RIDER_SEASON_STANDINGS) private readonly standings: RiderSeasonStandings,
    private readonly identity: IdentityAccounts,
    private readonly repository: AchievementsRepository,
    private readonly state: AchievementsSyncState,
    @InjectQueue(QUEUE.achievementsSync) private readonly queue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async run(): Promise<AchievementsSweepRun> {
    const read = { revisions: 0, rides: 0, route_rides: 0, seasons: 0 } satisfies Record<
      AchievementsSyncSource,
      number
    >;
    const token = await this.state.lock();
    if (!token) return { busy: true, read, enqueued: 0, failedSources: [] };
    try {
      return await this.sweep(token, read);
    } finally {
      await this.state.unlock(token);
    }
  }

  /** Аренда замка: продление своим токеном перед каждым шагом; потеряна — прогон прекращается без записи. */
  private async renew(token: string): Promise<void> {
    if (!(await this.state.extend(token))) this.leaseLost();
  }

  private leaseLost(): never {
    this.logger.warn('achievements.sweep_lease_lost');
    throw new Error('achievements.sweep lease lost');
  }

  private async sweep(
    token: string,
    read: Record<AchievementsSyncSource, number>,
  ): Promise<AchievementsSweepRun> {
    const now = this.clock.now();
    const failedSources: AchievementsSyncSource[] = [];
    const moved = new Map<AchievementsSyncSource, ChangedCursor>();
    const changed = new Set<string>();
    for (const source of ACHIEVEMENTS_SYNC_SOURCES) {
      await this.renew(token);
      const until = new Date(
        now.getTime() -
          (source === 'rides'
            ? ACHIEVEMENTS_SERVER_SYNC.rideSettleMs
            : ACHIEVEMENTS_SERVER_SYNC.settleMs),
      );
      try {
        const cursor = (await this.state.cursor(source)) ?? {
          at: new Date(until.getTime() - ACHIEVEMENTS_SERVER_SYNC.lostCursorMs),
          id: '',
        };
        const page = await this.page(source, cursor, until);
        read[source] = page.userIds.length;
        for (const userId of page.userIds) changed.add(userId);
        if (page.next) moved.set(source, page.next);
      } catch (error) {
        failedSources.push(source);
        const reason = error instanceof Error ? error.name : 'unknown';
        this.logger.warn(`achievements.sweep_source_failed source=${source} (${reason})`);
      }
    }

    const riders = await this.eligible([...changed]);
    await this.renew(token);
    if (riders.length > 0) {
      await this.queue.addBulk(
        riders.map((userId) => ({
          name: ACHIEVEMENTS_RIDER_JOB,
          data: { userId },
          opts: { jobId: achievementsRiderJobId(userId, now), ...ACHIEVEMENTS_RIDER_JOB_OPTIONS },
        })),
      );
    }
    // курсоры — только после постановки (сбой постановки повторит окно следующим прогоном) и только владельцем замка
    if (moved.size > 0 && !(await this.state.setCursors(token, moved))) this.leaseLost();

    const run: AchievementsSweepRun = { busy: false, read, enqueued: riders.length, failedSources };
    if (riders.length > 0) {
      this.logger.log(`achievements.sweep enqueued=${riders.length} read=${JSON.stringify(read)}`);
    }
    if (failedSources.length > 0) {
      throw new Error(`achievements.sweep failed: ${failedSources.join(',')}`);
    }
    return run;
  }

  private page(
    source: AchievementsSyncSource,
    cursor: ChangedCursor,
    until: Date,
  ): Promise<RiderChanges> {
    const limit = ACHIEVEMENTS_SERVER_SYNC.pageRows;
    switch (source) {
      case 'revisions':
        return this.results.revisedRidersAfter(cursor, until, limit);
      case 'rides':
        return this.rides.startedRidersAfter(cursor, until, limit);
      case 'route_rides':
        return this.routeRides.passedRidersAfter(cursor, until, limit);
      case 'seasons':
        return this.standings.settledRidersAfter(cursor, until, limit);
    }
  }

  /** Живые аккаунты с маркером первой сверки — пачками (один запрос на пачку каждого фильтра). */
  private async eligible(userIds: readonly string[]): Promise<string[]> {
    const result: string[] = [];
    for (const batch of chunks(userIds, ACHIEVEMENTS_SERVER_SYNC.recipientsBatch)) {
      const live = [...(await this.identity.liveUserIds(batch))];
      const synced = await this.repository.syncedAmong(live);
      result.push(...live.filter((userId) => synced.has(userId)));
    }
    return result;
  }
}
