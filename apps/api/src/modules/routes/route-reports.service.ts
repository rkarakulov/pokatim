import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CatalogRouteViewer,
  CreateRouteReportRequest,
  RateLimitedDetails,
  RouteStateDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { ROUTE_REPORTS_UNIQUE_INDEX, RouteReportsRepository } from './route-reports.repository';
import type { RouteDoc } from './routes.collection';
import { ROUTE_POLICY } from './routes.policy';
import { RoutesRepository } from './routes.repository';

const invalidState = (reason: RouteStateDetails['reason']) =>
  domainError('ROUTE_INVALID_STATE', 409, { reason } satisfies RouteStateDetails);

/**
 * Жалобы на маршруты райдеров в каталоге и состояние зрителя карточки (routes-06, A4): одна жалоба от пользователя на
 * маршрут; автор не жалуется на свой, маршруты команды жалоб не принимают; не в каталоге — 404. Транзакция:
 * **первой** — условная запись маршрута (`$inc openReportCount` и `reportRevision`, `$max lastReportAt`), затем
 * вставка жалобы: конкурирующее «Скрыть» пишет тот же документ первым — транзакции конфликтуют. Дубль по уникальному
 * индексу — откат и идемпотентный успех. Логи — без комментария и названия.
 */
@Injectable()
export class RouteReportsService {
  private readonly logger = new Logger(RouteReportsService.name);

  constructor(
    private readonly routes: RoutesRepository,
    private readonly reports: RouteReportsRepository,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `GET /v1/routes/:id/me`: только маршрут каталога (иначе 404). */
  async viewer(userId: string, id: string): Promise<CatalogRouteViewer> {
    const route = await this.routes.findInCatalog(id);
    if (!route) throw domainError('NOT_FOUND', 404);
    const reported = await this.reports.exists(id, userId);
    const reportable = route.origin === 'rider' && route.ownerUserId !== userId;
    return { canReport: reportable && !reported, reported };
  }

  async report(
    userId: string,
    id: string,
    body: CreateRouteReportRequest,
  ): Promise<CatalogRouteViewer> {
    const limited = await this.rateLimiter.consume(
      `routes-report:${userId}`,
      ROUTE_POLICY.reportLimit,
      this.clock.now(),
    );
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    this.assertReportable(await this.routes.findInCatalog(id), userId);
    const done: CatalogRouteViewer = { canReport: false, reported: true };
    if (await this.reports.exists(id, userId)) return done;

    const now = this.clock.now();
    let recorded = false;
    try {
      recorded = await this.transactions.run(async (tx) => {
        if (!(await this.routes.recordRouteReport(tx, id, userId, now))) return false;
        await this.reports.insert(tx, {
          _id: uuidv7(),
          routeId: id,
          reporterUserId: userId,
          reason: body.reason,
          comment: body.comment ?? null,
          createdAt: now,
          resolvedAt: null,
          resolution: null,
          resolvedBy: null,
        });
        return true;
      });
    } catch (error) {
      // параллельная жалоба того же пользователя закоммитилась первой — успех без изменений
      if (!isDuplicateKey(error, ROUTE_REPORTS_UNIQUE_INDEX)) throw error;
      return done;
    }
    // условие записи не выполнено между чтением и транзакцией (скрыт, снят): причина — по свежему документу
    if (!recorded) {
      this.assertReportable(await this.routes.findInCatalog(id), userId);
      throw domainError('NOT_FOUND', 404);
    }
    this.logger.log(`routes.reported route=${id} uid=${userId} reason=${body.reason}`);
    return done;
  }

  /** Не в каталоге — 404; команды — 409 `team_route`; свой — 409 `own_route`. */
  private assertReportable(route: RouteDoc | undefined, userId: string): void {
    if (!route) throw domainError('NOT_FOUND', 404);
    if (route.origin === 'platform') throw invalidState('team_route');
    if (route.ownerUserId === userId) throw invalidState('own_route');
  }
}
