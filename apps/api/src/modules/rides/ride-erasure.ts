import { Inject, Injectable } from '@nestjs/common';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { RIDE_ROUTES, type RideRoutes } from '../routes';
import { RidePhotosRepository } from './ride-photos.repository';
import { RIDES_RIDE_CANCELLED, type RideEventPayload } from './rides.events';
import { RidesRepository } from './rides.repository';

/** Пачка поиска висячих `routeId` (≤ 200 id маршрутов в запросе порта — с запасом на повторы). */
const DANGLING_BATCH = 200;

export interface RideErasureResult {
  cancelled: number;
  left: number;
  unsigned: number;
  /** райды (любых организаторов) на маршрутах удалённого — точка сброшена на центр города (05c) */
  restarted: number;
  /** фото организатора удалены (ride-photo, ADR-0028), ссылки на райдах сняты */
  photos: number;
}

/**
 * Порт стирания кофе-райдов удалённого аккаунта (модуль `account`, ADR-0015, A6): будущие свои — отменены
 * («Организатор не сможет»; скрытые — в `hiddenFromStatus`), отметки в чужих будущих сняты, подпись организатора
 * стёрта во всех его райдах, фото организатора удалены (ride-photo, ADR-0028). Прошедшие чужие с отметкой и жалобы на райды не трогаются (A6). Повторяемо.
 * Отмена опубликованного — по одному райду: та же условная операция, что у организатора, в транзакции с событием
 * `rides.ride-cancelled` (ADR-0017); повтор фильтр не проходит — второго события нет. Скрытые — без события (RC-8).
 * Точки райдов на маршрутах удалённого (05c, 8.1 RC-1) — центр города: шаг `rides` идёт до шага `routes`, id
 * маршрутов ещё есть. Маршруты, удалённые автором раньше (и гонка с удалением во время шага), — отдельный шаг
 * `resetDanglingStarts` после шага `routes`.
 */
@Injectable()
export class RideErasure {
  constructor(
    private readonly repository: RidesRepository,
    private readonly photos: RidePhotosRepository,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(RIDE_ROUTES) private readonly rideRoutes: RideRoutes,
  ) {}

  async erase(userId: string, now: Date): Promise<RideErasureResult> {
    let cancelled = 0;
    for (const rideId of await this.repository.futurePublishedIdsOf(userId, now)) {
      if (await this.cancelOne(userId, rideId, now)) cancelled += 1;
    }
    cancelled += await this.repository.cancelHiddenFutureOf(userId, now);
    const left = await this.repository.leaveAllFuture(userId, now);
    const unsigned = await this.repository.clearOrganizerName(userId, now);
    // фото всех райдов организатора (любой статус): сначала ссылки (view не покажет висячий id), затем документы
    await this.repository.clearPhotosOf(userId, now);
    const photos = await this.photos.deleteAllOf(userId);
    const restarted = await this.repository.resetStartsForRoutes(
      await this.rideRoutes.ownedRouteIds(userId),
      now,
    );
    return { cancelled, left, unsigned, restarted, photos };
  }

  /**
   * Точные точки райдов (любых организаторов) на висячих `routeId` (маршрут уже удалён) — центр города (05c, RC-1).
   * Глобальный проход пачками по `_id` (`DANGLING_BATCH`), существование маршрутов — порт `RideRoutes.existing`.
   * Повтор — no-op: сброшенные уже не `startPrecise`.
   */
  async resetDanglingStarts(now: Date): Promise<number> {
    let reset = 0;
    let afterId: string | null = null;
    for (;;) {
      const page = await this.repository.precisePage(afterId, DANGLING_BATCH);
      const routeIds = [
        ...new Set(page.map((doc) => doc.routeId).filter((id): id is string => id !== null)),
      ];
      const existing = await this.rideRoutes.existing(routeIds);
      const dangling = routeIds.filter((id) => !existing.has(id));
      if (dangling.length > 0) reset += await this.repository.resetStartsForRoutes(dangling, now);
      const last = page.at(-1);
      if (page.length < DANGLING_BATCH || !last) return reset;
      afterId = last._id;
    }
  }

  private cancelOne(userId: string, rideId: string, now: Date): Promise<boolean> {
    return this.transactions.run(async (tx) => {
      const doc = await this.repository.cancel(rideId, userId, 'organizer_unavailable', now, tx);
      if (!doc) return false;
      const payload: RideEventPayload = { rideId };
      await this.outbox.append(tx, { type: RIDES_RIDE_CANCELLED, payload });
      return true;
    });
  }
}
