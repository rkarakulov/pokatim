import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RespectState } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { RESULTS_FOR_SOCIAL, type ResultsForSocial } from '../results';
import { ROUTES_FOR_SOCIAL, type RoutesForSocial } from '../routes';
import { type RespectTarget, SocialReactionsService } from './reactions.service';
import { NEUTRAL_RESPECT, respectStateView } from './respect.view';
import { SOCIAL_POLICY } from './social.policy';

/**
 * «Респект» зрителя (P4, K8, ADR-0027 п. 3): строке публичной таблицы гонки и маршруту райдера в каталоге. Цель и
 * получатель — только портами производителей (`RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL`); от клиента получатель не
 * принимается. `GET` без цели — нейтральное состояние (RC-P4-3), `PUT` — `404`; лимит `social-respect:<uid>` — первой
 * проверкой `PUT`. Запись — `SocialReactionsService.setRespect` (себе — `409 self`). Ответ — свежее состояние.
 */
@Injectable()
export class SocialRespectService {
  private readonly logger = new Logger(SocialRespectService.name);

  constructor(
    private readonly reactions: SocialReactionsService,
    private readonly rateLimiter: RateLimiter,
    @Inject(RESULTS_FOR_SOCIAL) private readonly results: ResultsForSocial,
    @Inject(ROUTES_FOR_SOCIAL) private readonly routes: RoutesForSocial,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async raceEntryState(viewerId: string, raceId: string, entryId: string): Promise<RespectState> {
    return this.stateOf(viewerId, await this.raceEntryTarget(raceId, entryId));
  }

  async setRaceEntry(
    viewerId: string,
    raceId: string,
    entryId: string,
    respected: boolean,
  ): Promise<RespectState> {
    await this.consumeLimit(viewerId);
    return this.set(viewerId, await this.raceEntryTarget(raceId, entryId), respected);
  }

  async routeState(viewerId: string, routeId: string): Promise<RespectState> {
    return this.stateOf(viewerId, await this.routeTarget(routeId));
  }

  async setRoute(viewerId: string, routeId: string, respected: boolean): Promise<RespectState> {
    await this.consumeLimit(viewerId);
    return this.set(viewerId, await this.routeTarget(routeId), respected);
  }

  /** Строка видна в таблице и принадлежит гонке из пути (иначе — ссылка на чужую гонку, как нет цели). */
  private async raceEntryTarget(raceId: string, entryId: string): Promise<RespectTarget | null> {
    const target = await this.results.respectTarget(entryId);
    if (!target || target.raceId !== raceId) return null;
    return { targetType: 'race_entry', targetId: target.entryId, recipientId: target.ownerUserId };
  }

  private async routeTarget(routeId: string): Promise<RespectTarget | null> {
    const target = await this.routes.respectTarget(routeId);
    return target
      ? { targetType: 'route', targetId: target.routeId, recipientId: target.authorUserId }
      : null;
  }

  private consumeLimit(viewerId: string): Promise<void> {
    return consumeUserLimit(
      this.rateLimiter,
      `social-respect:${viewerId}`,
      SOCIAL_POLICY.respectLimit,
      this.clock.now(),
    );
  }

  private async set(
    viewerId: string,
    target: RespectTarget | null,
    respected: boolean,
  ): Promise<RespectState> {
    if (!target) throw domainError('NOT_FOUND', 404);
    const changed = await this.reactions.setRespect(viewerId, target, respected);
    this.logger.log(
      `social.respect target=${target.targetType}:${target.targetId} uid=${viewerId} respected=${respected} changed=${changed}`,
    );
    return this.stateOf(viewerId, target);
  }

  /** Состояние зрителя: поставившие — только получателю (имена — порт `RIDER_NAMES`, K3). */
  private async stateOf(viewerId: string, target: RespectTarget | null): Promise<RespectState> {
    if (!target) return NEUTRAL_RESPECT;
    const own = viewerId === target.recipientId;
    const [count, respected, actorIds] = await Promise.all([
      this.reactions.countFor(target.targetType, target.targetId, 'respect'),
      own ? false : this.reactions.respectedBy(viewerId, target),
      own ? this.reactions.respectActors(target, SOCIAL_POLICY.respectFromMax) : [],
    ]);
    const cards = own ? await this.names.publicRiders(actorIds) : new Map();
    return respectStateView({ target, viewerId, count, respected, actorIds, cards });
  }
}
