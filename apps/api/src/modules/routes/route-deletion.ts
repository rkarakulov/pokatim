import { Injectable } from '@nestjs/common';

import type { DbSession } from '../../db';
import { RouteReportsRepository } from './route-reports.repository';
import { RoutesRepository } from './routes.repository';

/**
 * Удаление своего маршрута райдера каскадом (routes-06, U6) — в транзакции вызывающего: маршрут, геометрия, исходник,
 * экспорт (`RoutesRepository.deleteOwn`) и все жалобы на него (`RouteReportsRepository.deleteForRoute`). Публикация —
 * поле документа маршрута, уходит вместе с ним. Вызывают `MyRoutesService.delete` и `RouteErasure.erase`.
 */
@Injectable()
export class RouteDeletion {
  constructor(
    private readonly routes: RoutesRepository,
    private readonly reports: RouteReportsRepository,
  ) {}

  /** `false` — не свой или нет (ничего не удалено). */
  async deleteOwn(tx: DbSession, ownerUserId: string, id: string): Promise<boolean> {
    if (!(await this.routes.deleteOwn(tx, ownerUserId, id))) return false;
    await this.reports.deleteForRoute(tx, id);
    return true;
  }
}
