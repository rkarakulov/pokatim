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

const pngKey = (hash: string) => `og:png:${hash}`;
const pendingKey = (hash: string) => `og:pending:${hash}`;
const cursorKey = (kind: OgCardKind) => `og:cursor:${kind}`;
const SWEEP_KEY = 'og:sweep';

const Cursor = z.object({ at: z.iso.datetime(), id: z.string() });

/**
 * Кэш OG-картинок (og-images, ADR-0018) — Redis, не MongoDB: PNG по хэшу входов (адрес публичный по смыслу — не
 * капабилити), TTL `pngTtlSec` с продлением при выдаче; ключ постановки рендера (NX); курсоры `og.sync` по видам и
 * отметка полного прохода (тема + версия рендера). Ключи — хэш и вид, без названий.
 */
@Injectable()
export class OgCardCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** PNG по хэшу с продлением TTL (картинка, которую спрашивают, живёт); нет — `null`. */
  png(hash: string): Promise<Buffer | null> {
    return this.redis.getexBuffer(pngKey(hash), 'EX', OG_CARD_POLICY.pngTtlSec);
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

  /** PNG и снятие постановки — одной транзакцией. */
  async storeReady(hash: string, png: Buffer): Promise<void> {
    await this.redis
      .multi()
      .set(pngKey(hash), png, 'EX', OG_CARD_POLICY.pngTtlSec)
      .del(pendingKey(hash))
      .exec();
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
