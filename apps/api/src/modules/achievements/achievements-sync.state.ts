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

/** Продление аренды только своим токеном: `1` — продлена, `0` — замок истёк или чужой. */
const EXTEND = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0
`;

/**
 * Запись курсоров только владельцем замка, атомарно с проверкой токена: `KEYS[1]` — замок, `KEYS[2..]` — курсоры,
 * `ARGV[1]` — токен, `ARGV[2..]` — значения. `0` — владение потеряно, ничего не записано.
 */
const SET_CURSORS = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
for i = 2, #KEYS do redis.call('SET', KEYS[i], ARGV[i]) end
return 1
`;

/**
 * Состояние регламента `achievements.sweep` в Redis (как `og:cursor:<kind>`): курсоры источников JSON `{ at, id }`
 * (мусор — как нет курсора) и замок-аренда «один прогон за раз» (`SET NX PX`; продление и снятие — своим токеном;
 * курсоры пишет только владелец — проверка токена и запись одним Lua). Ключи — без `userId`.
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

  /**
   * Курсоры источников — только пока замок у `token` (истёкшая аренда не откатывает курсоры прогона, захватившего
   * замок). `false` — владение потеряно, ничего не записано.
   */
  async setCursors(
    token: string,
    cursors: ReadonlyMap<AchievementsSyncSource, ChangedCursor>,
  ): Promise<boolean> {
    const entries = [...cursors];
    const written = await this.redis.eval(
      SET_CURSORS,
      1 + entries.length,
      ACHIEVEMENTS_SWEEP_LOCK_KEY,
      ...entries.map(([source]) => achievementsCursorKey(source)),
      token,
      ...entries.map(([, cursor]) =>
        JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id }),
      ),
    );
    return written === 1;
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

  /** Продление аренды своим токеном на `lockTtlMs`; `false` — замок истёк или достался другому прогону. */
  async extend(token: string): Promise<boolean> {
    const extended = await this.redis.eval(
      EXTEND,
      1,
      ACHIEVEMENTS_SWEEP_LOCK_KEY,
      token,
      ACHIEVEMENTS_SERVER_SYNC.lockTtlMs,
    );
    return extended === 1;
  }

  async unlock(token: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, ACHIEVEMENTS_SWEEP_LOCK_KEY, token);
  }
}
