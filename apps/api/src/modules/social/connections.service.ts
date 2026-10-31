import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionSource } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { PRODUCT_EVENTS, type ProductEvents } from '../product-events';
import { type PublicRiderCard, RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { CONNECTIONS_UNIQUE_INDEX, ConnectionsRepository } from './connections.repository';
import { connectionSources, SOCIAL_POLICY, socialBlocked } from './social.policy';

/** Строка списка «своих» владельца (K6): только публичные профили. */
export interface ConnectionView {
  otherId: string;
  card: PublicRiderCard;
  sources: ConnectionSource[];
  rideCount: number;
  lastRideAt: Date | null;
}

/** «Вместе ехали» для пары относительно смотрящего (K6). */
export interface Together {
  rideCount: number;
  lastRideAt: Date | null;
}

/**
 * Связи «Свои» (K1, K3, K9, K11): ручное «В свои», тихое удаление, связь по приглашению, список владельца и «вместе
 * ехали». Публичность другого проверяется при чтении (K3); исключение — ручное добавление (только к публичному).
 */
@Injectable()
export class SocialConnectionsService {
  constructor(
    private readonly connections: ConnectionsRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly transactions: MongoTransactions,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
    @Inject(PRODUCT_EVENTS) private readonly events: ProductEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * «В свои» (K1, K11): лимит — на каждую попытку и до остальных проверок (против перебора профилей); себе — нельзя;
   * неизвестный, непубличный и удалённый — одинаковый `404 NOT_FOUND` (RC-16). Снимает `removedAt`. `true` — связь
   * создана.
   */
  async addManual(ownerId: string, otherId: string): Promise<boolean> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `social-manual:${ownerId}`,
      SOCIAL_POLICY.manualLimit,
      now,
    );
    if (ownerId === otherId) throw socialBlocked('self');
    if (!(await this.names.publicRiders([otherId])).has(otherId)) {
      throw domainError('NOT_FOUND', 404);
    }
    const pair = { ownerId, otherId };
    const once = () =>
      this.transactions.run(async (tx) => {
        const created = await this.connections.upsertManual(tx, pair, now);
        if (created) {
          await this.events.record(
            { type: 'connection-created', userId: ownerId, props: { source: 'manual' } },
            tx,
          );
        }
        return created;
      });
    try {
      return await once();
    } catch (error) {
      // гонка первых upsert одной пары: второй видит созданный документ
      if (!isDuplicateKey(error, CONNECTIONS_UNIQUE_INDEX)) throw error;
      return once();
    }
  }

  /** «Убрать из своих» (K1): тихо, документ остаётся надгробием (RC-6). */
  async remove(ownerId: string, otherId: string): Promise<void> {
    await this.connections.remove({ ownerId, otherId }, this.clock.now());
  }

  /**
   * Связь `invite` в обе стороны (K9): событие `connection-created` — по созданным документам; `invite-registered`
   * (K12, `userId` пригласившего) — когда у стороны `inviter → invitee` `inviteAt` впервые стал не-`null` (RC-P6-8).
   * Возвращает этот признак (P7); повтор — `false`, без дублей. Гонка первых upsert пары — как в `addManual`.
   */
  async linkInvite(inviterId: string, inviteeId: string): Promise<boolean> {
    if (inviterId === inviteeId) return false;
    const now = this.clock.now();
    const once = () =>
      this.transactions.run(async (tx) => {
        let registered = false;
        for (const [ownerId, otherId] of [
          [inviterId, inviteeId],
          [inviteeId, inviterId],
        ] as const) {
          const outcome = await this.connections.upsertInvite(tx, { ownerId, otherId }, now);
          if (outcome === 'inserted') {
            await this.events.record(
              { type: 'connection-created', userId: ownerId, props: { source: 'invite' } },
              tx,
            );
          }
          if (ownerId === inviterId && outcome !== 'unchanged') registered = true;
        }
        if (registered) {
          await this.events.record({ type: 'invite-registered', userId: inviterId, props: {} }, tx);
        }
        return registered;
      });
    try {
      return await once();
    } catch (error) {
      if (!isDuplicateKey(error, CONNECTIONS_UNIQUE_INDEX)) throw error;
      return once();
    }
  }

  /** «Свои» владельца (K6): не убранные, только с публичным профилем другого (K3). */
  async listOf(ownerId: string): Promise<ConnectionView[]> {
    const docs = await this.connections.listOf(ownerId);
    const cards = await this.names.publicRiders(docs.map((doc) => doc.otherId));
    return docs.flatMap((doc) => {
      const card = cards.get(doc.otherId);
      if (!card) return [];
      return [
        {
          otherId: doc.otherId,
          card,
          sources: connectionSources(doc),
          rideCount: doc.rideCount,
          lastRideAt: doc.lastRideAt,
        },
      ];
    });
  }

  /** «Вместе ехали N раз · последний — дата» относительно смотрящего: факт совместных райдов (и после «Убрать»). */
  async togetherOf(viewerId: string, otherId: string): Promise<Together> {
    const doc = await this.connections.findPair({ ownerId: viewerId, otherId });
    return { rideCount: doc?.rideCount ?? 0, lastRideAt: doc?.lastRideAt ?? null };
  }
}
