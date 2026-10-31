import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import type { ChangedCursor } from '../../changed-since';
import { ACHIEVEMENTS_SERVER_SYNC } from './achievements.policy';

/** Источники серверной сверки — по одному методу портов владельцев (5.D). */
export const ACHIEVEMENTS_SYNC_SOURCES = ['revisions', 'rides', 'route_rides', 'seasons'] as const;
export type AchievementsSyncSource = (typeof ACHIEVEMENTS_SYNC_SOURCES)[number];

export const achievementsCursorKey = (source: AchievementsSyncSource) =>
  `achievements:cursor:${source}`;
export const ACHIEVEMENTS_SWEEP_LOCK_KEY = 'achievements:sweep:lock';

const Cursor = z.object({ at: z.iso.datetime(), id: z.string() });

/** Снятие замка только своим токеном (замок мог истечь и достаться другому прогону). */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

/**
 * Состояние регламента `achievements.sweep` в Redis (как `og:cursor:<kind>`): курсоры источников JSON `{ at, id }`
 * (мусор — как нет курсора) и замок «один прогон за раз» (`SET NX PX`, снятие своим токеном). Ключи — без `userId`.
 */
@Injectable()
export class AchievementsSyncState {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async cursor(source: AchievementsSyncSource): Promise<ChangedCursor | null> {
    const raw = await this.redis.get(achievementsCursorKey(source));
    if (!raw) return null;
    try {
      const parsed = Cursor.safeParse(JSON.parse(raw));
      return parsed.success ? { at: new Date(parsed.data.at), id: parsed.data.id } : null;
    } catch {
      return null;
    }
  }

  async setCursor(source: AchievementsSyncSource, cursor: ChangedCursor): Promise<void> {
    await this.redis.set(
      achievementsCursorKey(source),
      JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id }),
    );
  }

  /** Замок прогона: токен — захвачен, `null` — идёт другой прогон. */
  async lock(): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(
      ACHIEVEMENTS_SWEEP_LOCK_KEY,
      token,
      'PX',
      ACHIEVEMENTS_SERVER_SYNC.lockTtlMs,
      'NX',
    );
    return result === 'OK' ? token : null;
  }

  async unlock(token: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, ACHIEVEMENTS_SWEEP_LOCK_KEY, token);
  }
}
