import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  MyRoute,
  RateLimitedDetails,
  RoutePublicationLimitDetails,
  RouteStateDetails,
  SubmitRoutePublicationInput,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { toMyRoute } from './my-routes.service';
import type { RouteDoc } from './routes.collection';
import { publicationTransition, ROUTE_POLICY } from './routes.policy';
import { RoutesRepository } from './routes.repository';

const notFound = () => domainError('NOT_FOUND', 404);

const invalidState = (reason: RouteStateDetails['reason']) =>
  domainError('ROUTE_INVALID_STATE', 409, { reason } satisfies RouteStateDetails);

const limitReached = (limit: RoutePublicationLimitDetails['limit'], max: number) =>
  domainError('ROUTE_PUBLICATION_LIMIT', 409, {
    limit,
    max,
  } satisfies RoutePublicationLimitDetails);

/**
 * Публикация своего маршрута в каталог автором (routes-06): подача заявки, отзыв заявки и снятие с публикации. Каждое
 * действие — одна атомарная запись документа `routes` (условия — в фильтре `RoutesRepository`; подача — в транзакции
 * с суточной квотой), без журнала панели (действия райдера в журнал не пишутся, правило routes-02). Чужой, команды и
 * неизвестный — один `404`. Логи — id и коды, без названий.
 */
@Injectable()
export class MyRoutePublicationService {
  private readonly logger = new Logger(MyRoutePublicationService.name);

  constructor(
    private readonly repository: RoutesRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Подача (порядок проверок — task.md §11): свой → готов → состояние → подач < 3 → на проверке < 3 (принятая гонка,
   * 8.1 RC-7) → в одной транзакции условная запись, затем суточный лимит (RC-8: тратят только успешные подачи — отказ
   * 409 и проигравшая параллельная подача квоту не списывают; 429 откатывает запись). Запись не прошла — причина по
   * свежему документу.
   */
  async submit(userId: string, id: string, input: SubmitRoutePublicationInput): Promise<MyRoute> {
    this.assertSubmittable(await this.own(userId, id));
    if ((await this.repository.countPendingOwn(userId)) >= ROUTE_POLICY.maxPendingPublications) {
      throw limitReached('pending', ROUTE_POLICY.maxPendingPublications);
    }
    const now = this.clock.now();
    // запись — первой в транзакции: параллельная подача того же маршрута ждёт (write conflict → повтор) и после
    // коммита не проходит фильтр, до квоты не доходит; квота кончилась — 429 откатывает запись
    const submitted = await this.transactions.run(async (tx) => {
      const written = await this.repository.submitPublication(
        tx,
        userId,
        id,
        input,
        ROUTE_POLICY.maxSubmissionsPerRoute,
        now,
      );
      if (!written) return null;
      // Исключение из правила «в колбэке транзакции — только операции с session» (pokatim-db.md, второе после R12):
      // `RateLimiter` не умеет вернуть единицу, поэтому квота — после записи. При повторе колбэка на транзиентной
      // ошибке коммита одна подача спишет квоту дважды, при сбое коммита — без заявки. Принято как редкое (task.md §8.2).
      const limited = await this.rateLimiter.consume(
        `routes-publication-submit:${userId}`,
        ROUTE_POLICY.publicationSubmitLimit,
        now,
      );
      if (!limited.allowed) {
        const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
        throw domainError('RATE_LIMITED', 429, details);
      }
      return written;
    });
    if (!submitted) {
      this.assertSubmittable(await this.own(userId, id));
      throw domainError('CONFLICT', 409);
    }
    this.logger.log(`route ${id} submitted by ${userId}`);
    return toMyRoute(submitted);
  }

  /**
   * Отзыв заявки (`pending`) и снятие с публикации (`approved`) — одно действие. Нет активной заявки — успех без
   * записи; скрыт модератором — `409 hidden` (A1: только удалить).
   */
  async withdraw(userId: string, id: string): Promise<MyRoute> {
    const route = await this.own(userId, id);
    if (!this.withdrawable(route)) return toMyRoute(route);
    const withdrawn = await this.repository.withdrawPublication(userId, id, this.clock.now());
    if (withdrawn) {
      this.logger.log(`route ${id} withdrawn by ${userId}`);
      return toMyRoute(withdrawn);
    }
    const fresh = await this.own(userId, id);
    this.withdrawable(fresh);
    return toMyRoute(fresh);
  }

  /** `true` — есть что отзывать; `false` — успех без записи; скрытый — 409. */
  private withdrawable(route: RouteDoc): boolean {
    const transition = publicationTransition(route.publication?.status ?? null, 'withdraw');
    if (transition.result === 'invalid') throw invalidState('hidden');
    return transition.result === 'ok';
  }

  private assertSubmittable(route: RouteDoc): void {
    if (route.status !== 'ready') throw invalidState('not_ready');
    const publication = route.publication ?? null;
    const transition = publicationTransition(publication?.status ?? null, 'submit');
    if (transition.result === 'invalid') throw invalidState(transition.reason ?? 'in_review');
    if ((publication?.submissionCount ?? 0) >= ROUTE_POLICY.maxSubmissionsPerRoute) {
      throw limitReached('route_submissions', ROUTE_POLICY.maxSubmissionsPerRoute);
    }
  }

  private async own(userId: string, id: string): Promise<RouteDoc> {
    const route = await this.repository.findOwn(userId, id);
    if (!route) throw notFound();
    return route;
  }
}
