import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { StoryCardTemplate, StoryCardToken } from '@pokatim/contracts';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { STORY_CARD_POLICY } from './sharing.policy';

/** Задача очереди `story-card`: только id и хэш входов — данные карточки worker перечитывает сам. */
export const STORY_CARD_RENDER_JOB = 'story-card.render';
export const StoryCardJob = z.object({
  userId: z.string(),
  raceId: z.string(),
  template: StoryCardTemplate,
  hash: z.string(),
});
export type StoryCardJob = z.infer<typeof StoryCardJob>;

const tokenKey = (hash: string) => `story-card:token:${hash}`;
const pngKey = (token: string) => `story-card:png:${token}`;
const pendingKey = (hash: string) => `story-card:pending:${hash}`;
const failedKey = (hash: string) => `story-card:failed:${hash}`;

/**
 * Кэш карточек для сторис (story-cards): PNG по капабилити-токену и ключ «хэш входов → токен» — Redis с TTL 24 ч, не
 * MongoDB; ключ постановки рендера (NX) и отметка провала. Ключи — хэш и токен, без `userId` и имени.
 */
@Injectable()
export class StoryCardCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Токен готовой картинки этих входов; PNG истёк — `null`. */
  async readyToken(hash: string): Promise<string | null> {
    const token = await this.redis.get(tokenKey(hash));
    if (!token || !StoryCardToken.safeParse(token).success) return null;
    return (await this.redis.exists(pngKey(token))) === 1 ? token : null;
  }

  /** Отметка провала рендера — снимается чтением: отказ сообщается один раз. */
  async takeFailed(hash: string): Promise<boolean> {
    return (await this.redis.getdel(failedKey(hash))) !== null;
  }

  /** Постановка рендера — одна на хэш, пока ключ жив; `false` — уже поставлена. */
  async claim(hash: string): Promise<boolean> {
    const result = await this.redis.set(
      pendingKey(hash),
      '1',
      'EX',
      STORY_CARD_POLICY.pendingTtlSec,
      'NX',
    );
    return result === 'OK';
  }

  async release(hash: string): Promise<void> {
    await this.redis.del(pendingKey(hash));
  }

  /** PNG под новым токеном и ключ хэша — одной транзакцией (PNG первым), снять постановку и провал. */
  async storeReady(hash: string, png: Buffer): Promise<string> {
    const token = randomBytes(16).toString('base64url');
    await this.redis
      .multi()
      .set(pngKey(token), png, 'EX', STORY_CARD_POLICY.pngTtlSec)
      .set(tokenKey(hash), token, 'EX', STORY_CARD_POLICY.pngTtlSec)
      .del(pendingKey(hash), failedKey(hash))
      .exec();
    return token;
  }

  async storeFailed(hash: string): Promise<void> {
    await this.redis
      .multi()
      .set(failedKey(hash), '1', 'EX', STORY_CARD_POLICY.failedTtlSec)
      .del(pendingKey(hash))
      .exec();
  }

  /** PNG по токену; кривой токен — `null` без запроса в Redis. */
  async png(token: string): Promise<Buffer | null> {
    if (!StoryCardToken.safeParse(token).success) return null;
    return this.redis.getBuffer(pngKey(token));
  }
}
