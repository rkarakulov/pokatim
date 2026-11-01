import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditAction, PanelRoute, PublishRouteInput } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { PanelAudit, type PanelPrincipal } from '../panel';
import type { RouteCatalogDoc, RouteDoc } from './routes.collection';
import { RoutesRepository } from './routes.repository';
import { RoutesService, visible } from './routes.service';

type CatalogField = 'title' | 'city' | 'surfaces';

/** Итог действия в транзакции: документ после записи и запись журнала (`null` — ничего не изменилось). */
interface Outcome {
  route: RouteDoc;
  action: AuditAction | null;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

/**
 * Каталог маршрутов в панели (routes-01, RC-2, RC-3, RC-10): публикация готового маршрута, правка города и покрытия
 * опубликованного, снятие; название — при публикации и правке (routes-08, RC-14). Транзакция «чтение маршрута →
 * запись того же документа → журнал»: две транзакции одного маршрута конфликтуют по документу и повторяются на свежем
 * снимке. Повтор с теми же значениями и снятие неопубликованного — без записи и журнала. Колбэк транзакции — без логов
 * (повторяется).
 */
@Injectable()
export class RoutesCatalogAdminService {
  private readonly logger = new Logger(RoutesCatalogAdminService.name);

  constructor(
    private readonly repository: RoutesRepository,
    private readonly routes: RoutesService,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  publish(principal: PanelPrincipal, id: string, input: PublishRouteInput): Promise<PanelRoute> {
    return this.act(principal, id, async (tx, route, now) => {
      const current = route.catalog ?? null;
      const title = input.title ?? route.title;
      const renamed = title !== route.title;
      const changedFields: CatalogField[] = [
        ...(renamed ? (['title'] as const) : []),
        ...(current && current.city !== input.city ? (['city'] as const) : []),
        ...(current && !sameSet(current.surfaces, input.surfaces) ? (['surfaces'] as const) : []),
      ];
      if (current && changedFields.length === 0) return { route, action: null };
      const catalog: RouteCatalogDoc = {
        city: input.city,
        surfaces: [...input.surfaces],
        publishedAt: current?.publishedAt ?? now,
      };
      await this.write(
        this.repository.setCatalog(tx, id, catalog, now, renamed ? title : undefined),
      );
      const action = current ? 'route.catalog_updated' : 'route.published';
      await this.audit.append(tx, {
        action,
        actor: { kind: 'user', userId: principal.userId },
        subject: { kind: 'route', id, label: title },
        details: changedFields.length ? { changedFields } : null,
      });
      return { route: { ...route, title, catalog, updatedAt: now }, action };
    });
  }

  unpublish(principal: PanelPrincipal, id: string): Promise<PanelRoute> {
    return this.act(principal, id, async (tx, route, now) => {
      if (!route.catalog) return { route, action: null };
      await this.write(this.repository.clearCatalog(tx, id, now));
      await this.audit.append(tx, {
        action: 'route.unpublished',
        actor: { kind: 'user', userId: principal.userId },
        subject: { kind: 'route', id, label: route.title },
      });
      return { route: { ...route, catalog: null, updatedAt: now }, action: 'route.unpublished' };
    });
  }

  /** Видимость и статус — на снимке транзакции; лог — после коммита. */
  private async act(
    principal: PanelPrincipal,
    id: string,
    change: (tx: DbSession, route: RouteDoc, now: Date) => Promise<Outcome>,
  ): Promise<PanelRoute> {
    const now = this.clock.now();
    const outcome = await this.transactions.run(async (tx) => {
      const route = await this.repository.findRoute(id, tx);
      if (!route || !visible(principal, route)) throw domainError('NOT_FOUND', 404);
      if (route.status !== 'ready') throw domainError('ROUTE_INVALID_STATE', 409);
      return change(tx, route, now);
    });
    if (outcome.action) this.logger.log(`route ${id} ${outcome.action} by ${principal.userId}`);
    return this.routes.view(outcome.route);
  }

  /** Условие записи (`ready`) прочитано в той же транзакции — расхождение означает нарушение инварианта. */
  private async write(updated: Promise<boolean>): Promise<void> {
    if (!(await updated)) throw domainError('ROUTE_INVALID_STATE', 409);
  }
}
