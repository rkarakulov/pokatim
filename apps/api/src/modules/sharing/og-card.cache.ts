import { Inject, Injectable } from '@nestjs/common';
import { OG_CARD_KINDS, type OgCardKind } from '@pokatim/contracts';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { OG_CARD_POLICY } from './sharing.policy';

/** Задача очереди `story-card`: вид, id объекта (бренд — `site`) и хэш входов — данные worker перечитывает сам. */
export const OG_CARD_RENDER_JOB = 'og-card.render';
export const OgCardJob = z.object({
  kind: z.enum([...OG_CARD_KINDS, 'brand']),
  id: z.string(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type OgCardJob = z.infer<typeof OgCardJob>;

const PNG_PREFIX = 'og:png:';
const pngKey = (hash: string) => `${PNG_PREFIX}${hash}`;
const objKey = (kind: string, id: string) => `og:obj:${kind}:${id}`;

/**
 * Готовый PNG атомарно (Lua): PNG нового хэша, ключ объекта → хэш, снять постановку и удалить PNG прежнего хэша
 * объекта, если он другой (старая версия по URL недостижима — `302`; иначе правки копили бы PNG до TTL, ревью F1).
 * KEYS: объект, PNG, постановка; ARGV: PNG, TTL PNG, хэш, TTL объекта, префикс PNG.
 */
const STORE_READY = `
local old = redis.call('GET', KEYS[1])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
redis.call('DEL', KEYS[3])
if old and old ~= ARGV[3] then redis.call('DEL', ARGV[5] .. old) end
return 1
`;
const pendingKey = (hash: string) => `og:pending:${hash}`;
const cursorKey = (kind: OgCardKind) => `og:cursor:${kind}`;
const SWEEP_KEY = 'og:sweep';

const Cursor = z.object({ at: z.iso.datetime(), id: z.string() });

/**
 * Кэш OG-картинок (og-images, ADR-0018) — Redis, не MongoDB: PNG по хэшу входов (адрес публичный по смыслу — не
 * капабилити), TTL с продлением при выдаче, ключ объекта → текущий хэш (одна версия PNG на объект); ключ постановки рендера (NX); курсоры `og.sync` по видам и
 * отметка полного прохода (тема + версия рендера). Ключи — хэш и вид, без названий.
 */
@Injectable()
export class OgCardCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** PNG объекта по хэшу с продлением TTL PNG и ключа объекта (картинка, которую спрашивают, живёт); нет — `null`. */
  async png(target: { kind: string; id: string; hash: string }): Promise<Buffer | null> {
    const ttl = OG_CARD_POLICY.pngTtlSec;
    const [png] = await Promise.all([
      this.redis.getexBuffer(pngKey(target.hash), 'EX', ttl),
      this.redis.expire(objKey(target.kind, target.id), ttl),
    ]);
    return png;
  }

  async hasPng(hash: string): Promise<boolean> {
    return (await this.redis.exists(pngKey(hash))) === 1;
  }

  /** Постановка рендера — одна на хэш, пока ключ жив; `false` — уже поставлена (или удержана после провала). */
  async claim(hash: string): Promise<boolean> {
    const result = await this.redis.set(
      pendingKey(hash),
      '1',
      'EX',
      OG_CARD_POLICY.pendingTtlSec,
      'NX',
    );
    return result === 'OK';
  }

  async release(hash: string): Promise<void> {
    await this.redis.del(pendingKey(hash));
  }

  /**
   * PNG объекта с TTL `ttlSec` (пререндер — `pngTtlSec`, самолечение вне окна — `pngShortTtlSec`), ключ объекта → хэш,
   * снятие постановки и удаление PNG прежней версии объекта — одной атомарной операцией.
   */
  async storeReady(
    target: { kind: string; id: string; hash: string },
    png: Buffer,
    ttlSec: number,
  ): Promise<void> {
    await this.redis.eval(
      STORE_READY,
      3,
      objKey(target.kind, target.id),
      pngKey(target.hash),
      pendingKey(target.hash),
      png,
      ttlSec,
      target.hash,
      OG_CARD_POLICY.pngTtlSec,
      PNG_PREFIX,
    );
  }

  /** После финального провала: ключ постановки удержан `failedHoldSec` — самолечение не ставит рендер каждый запрос. */
  async holdFailed(hash: string): Promise<void> {
    await this.redis.set(pendingKey(hash), 'failed', 'EX', OG_CARD_POLICY.failedHoldSec);
  }

  /** Курсор вида `og.sync`; мусор — `null` (проход с начала). */
  async cursor(kind: OgCardKind): Promise<{ at: Date; id: string } | null> {
    const raw = await this.redis.get(cursorKey(kind));
    if (!raw) return null;
    try {
      const parsed = Cursor.safeParse(JSON.parse(raw));
      return parsed.success ? { at: new Date(parsed.data.at), id: parsed.data.id } : null;
    } catch {
      return null;
    }
  }

  async setCursor(kind: OgCardKind, cursor: { at: Date; id: string }): Promise<void> {
    await this.redis.set(
      cursorKey(kind),
      JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id }),
    );
  }

  async resetCursors(): Promise<void> {
    await this.redis.del(...OG_CARD_KINDS.map(cursorKey));
  }

  sweep(): Promise<string | null> {
    return this.redis.get(SWEEP_KEY);
  }

  async setSweep(value: string): Promise<void> {
    await this.redis.set(SWEEP_KEY, value);
  }
}
