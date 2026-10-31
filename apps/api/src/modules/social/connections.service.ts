import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionSource } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { PRODUCT_EVENTS, type ProductEvents } from '../product-events';
import { type PublicRiderCard, RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { ConnectionsRepository } from './connections.repository';
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

/** Состояние пары для профиля другого (K6). */
export interface PairState {
  connected: boolean;
  together: Together;
  inTheirs: boolean;
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
    // гонка первых upsert одной пары (и с пересчётом явки) — `WriteConflict`, повтор `withTransaction` (RC-P3-2)
    return this.transactions.run(async (tx) => {
      const created = await this.connections.upsertManual(tx, pair, now);
      if (created) {
        await this.events.record(
          { type: 'connection-created', userId: ownerId, props: { source: 'manual' } },
          tx,
        );
      }
      return created;
    });
  }

  /** «Убрать из своих» (K1): тихо, документ остаётся надгробием (RC-6). */
  async remove(ownerId: string, otherId: string): Promise<void> {
    await this.connections.remove({ ownerId, otherId }, this.clock.now());
  }

  /** Связь `invite` в обе стороны (K9): событие `connection-created` — по созданным документам. */
  async linkInvite(inviterId: string, inviteeId: string): Promise<void> {
    if (inviterId === inviteeId) return;
    const now = this.clock.now();
    await this.transactions.run(async (tx) => {
      for (const [ownerId, otherId] of [
        [inviterId, inviteeId],
        [inviteeId, inviterId],
      ] as const) {
        if (await this.connections.upsertInvite(tx, { ownerId, otherId }, now)) {
          await this.events.record(
            { type: 'connection-created', userId: ownerId, props: { source: 'invite' } },
            tx,
          );
        }
      }
    });
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

  /**
   * Пара на профиле (K6, P3): `connected` — смотрящий держит связь к другому, `inTheirs` — смотрящий у другого в
   * «своих» (обе — документ есть и не убран); `together` — как `togetherOf`.
   */
  async pairState(viewerId: string, otherId: string): Promise<PairState> {
    const [mine, theirs] = await Promise.all([
      this.connections.findPair({ ownerId: viewerId, otherId }),
      this.connections.findPair({ ownerId: otherId, otherId: viewerId }),
    ]);
    return {
      connected: mine !== null && mine.removedAt === null,
      inTheirs: theirs !== null && theirs.removedAt === null,
      together: { rideCount: mine?.rideCount ?? 0, lastRideAt: mine?.lastRideAt ?? null },
    };
  }

  /** «Вместе ехали N раз · последний — дата» относительно смотрящего: факт совместных райдов (и после «Убрать»). */
  async togetherOf(viewerId: string, otherId: string): Promise<Together> {
    const doc = await this.connections.findPair({ ownerId: viewerId, otherId });
    return { rideCount: doc?.rideCount ?? 0, lastRideAt: doc?.lastRideAt ?? null };
  }
}
