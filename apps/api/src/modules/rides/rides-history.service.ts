import { Inject, Injectable } from '@nestjs/common';
import type { RiderHistoryQuery, RiderRideHistoryPage } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { decodeCursor, encodeCursor } from '../../page-cursor';
import { RidesRepository } from './rides.repository';

/**
 * «Райды» своего профиля (rider-profile, `GET /v1/profile/rides`): прошедшие неотменённые и нескрытые райды, где
 * пользователь — организатор или «Иду» (факта проезда в модели нет). Ответ — явный список полей: без организатора,
 * участников и места; дистанция — плановая организатора.
 */
@Injectable()
export class RidesHistoryService {
  constructor(
    private readonly repository: RidesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(userId: string, query: RiderHistoryQuery): Promise<RiderRideHistoryPage> {
    const before = query.cursor ? decodeCursor(query.cursor, z.iso.datetime()) : null;
    const docs = await this.repository.pastOf(
      userId,
      this.clock.now(),
      before ? { startsAt: new Date(before.k), id: before.id } : null,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((doc) => ({
        id: doc._id,
        title: doc.title,
        startsAt: doc.startsAt.toISOString(),
        distanceKm: doc.distanceKm,
        role: doc.organizerUserId === userId ? 'organizer' : 'participant',
      })),
      nextCursor:
        docs.length > query.limit && last
          ? encodeCursor(last.startsAt.toISOString(), last._id)
          : null,
    };
  }
}
