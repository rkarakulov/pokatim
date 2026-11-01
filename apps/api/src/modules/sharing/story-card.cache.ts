import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { AchievementCode, StoryCardTemplate, StoryCardToken, Uuid } from '@pokatim/contracts';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { STORY_CARD_POLICY } from './sharing.policy';

/**
 * Адрес приглашения на карточке (P6): считает HTTP, worker берёт из задачи — хэш совпадает детерминированно (RC-P6-5).
 * Задачи до выката — без поля → `null`.
 */
const InviteAddressField = z.string().max(80).nullable().default(null);

/** Задачи очереди `story-card`: только id и хэш входов — данные карточки worker перечитывает сам. */
export const STORY_CARD_RENDER_JOB = 'story-card.render';
export const StoryCardJob = z.object({
  userId: z.string(),
  raceId: z.string(),
  template: StoryCardTemplate,
  hash: z.string(),
  address: InviteAddressField,
});
export type StoryCardJob = z.infer<typeof StoryCardJob>;

/** Задача приглашения кофе-райда в той же очереди: id райда и зрителя (видимость), хэш входов. */
export const RIDE_INVITE_RENDER_JOB = 'ride-invite.render';
export const RideInviteJob = z.object({
  userId: z.string(),
  rideId: z.string(),
  template: StoryCardTemplate,
  hash: z.string(),
  address: InviteAddressField,
});
export type RideInviteJob = z.infer<typeof RideInviteJob>;

/**
 * Задача карточки достижения: код, сезон сезонного (задачи до выката — без поля → `null`) и владелец (своё
 * полученное), хэш входов.
 */
export const ACHIEVEMENT_CARD_RENDER_JOB = 'achievement-card.render';
export const AchievementCardJob = z.object({
  userId: z.string(),
  code: AchievementCode,
  seasonId: Uuid.nullable().default(null),
  template: StoryCardTemplate,
  hash: z.string(),
  address: InviteAddressField,
});
export type AchievementCardJob = z.infer<typeof AchievementCardJob>;

/** Задача карточки маршрута каталога: id маршрута и запрашивающего (тема), хэш входов. */
export const ROUTE_CARD_RENDER_JOB = 'route-card.render';
export const RouteCardJob = z.object({
  userId: z.string(),
  routeId: Uuid,
  template: StoryCardTemplate,
  hash: z.string(),
  address: InviteAddressField,
});
export type RouteCardJob = z.infer<typeof RouteCardJob>;

const tokenKey = (hash: string) => `story-card:token:${hash}`;
const pngKey = (token: string) => `story-card:png:${token}`;
const pendingKey = (hash: string) => `story-card:pending:${hash}`;
const failedKey = (hash: string) => `story-card:failed:${hash}`;
const bindingKey = (token: string) => `story-card:ride:${token}`;

/**
 * Привязка картинки приглашения к райду и нарисованному фото (ride-photo-followups): отдача PNG проверяет её
 * актуальность. `photoId` — фото на картинке (`night` с фото), иначе `null`.
 */
export interface InviteCardBinding {
  rideId: string;
  photoId: string | null;
}
const InviteCardBindingSchema = z.strictObject({
  rideId: Uuid,
  photoId: z.string().min(1).max(64).nullable(),
});

/** Привязка из Redis: нет — `null`; не JSON или не по схеме — `'invalid'`. */
function parseBinding(raw: string | null): InviteCardBinding | 'invalid' | null {
  if (raw === null) return null;
  try {
    const parsed = InviteCardBindingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * Кэш карточек (сторис гонки, приглашение райда, достижение, маршрут каталога — ADR-0018; хэш входов включает вид карточки): PNG по капабилити-токену и ключ «хэш входов → токен» — Redis с TTL 24 ч, не
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

  /**
   * PNG под новым токеном и ключ хэша — одной транзакцией (PNG первым), снять постановку и провал. Приглашение
   * (`binding`) — в той же транзакции привязка токена с тем же TTL.
   */
  async storeReady(hash: string, png: Buffer, binding?: InviteCardBinding): Promise<string> {
    const token = randomBytes(16).toString('base64url');
    const multi = this.redis.multi().set(pngKey(token), png, 'EX', STORY_CARD_POLICY.pngTtlSec);
    if (binding) {
      multi.set(bindingKey(token), JSON.stringify(binding), 'EX', STORY_CARD_POLICY.pngTtlSec);
    }
    await multi
      .set(tokenKey(hash), token, 'EX', STORY_CARD_POLICY.pngTtlSec)
      .del(pendingKey(hash), failedKey(hash))
      .exec();
    return token;
  }

  /**
   * PNG и привязка токена **одним снимком** (`MULTI`, ревью PR A): параллельный `revoke` не попадает между чтениями.
   * Нет PNG — `null`; привязки нет — `binding: null` (не приглашение или выдано до привязок); не разбирается —
   * `'invalid'` (отказ). Кривой токен — `null` без запроса в Redis.
   */
  async card(
    token: string,
  ): Promise<{ png: Buffer; binding: InviteCardBinding | 'invalid' | null } | null> {
    if (!StoryCardToken.safeParse(token).success) return null;
    const results = await this.redis.multi().getBuffer(pngKey(token)).get(bindingKey(token)).exec();
    const [pngReply, bindingReply] = results ?? [];
    if (!pngReply || !bindingReply) throw new Error('story-card read aborted');
    if (pngReply[0]) throw pngReply[0];
    if (bindingReply[0]) throw bindingReply[0];
    const png = pngReply[1] as Buffer | null;
    if (!png) return null;
    return { png, binding: parseBinding(bindingReply[1] as string | null) };
  }

  /** Отозвать картинку: PNG и привязка; ключ хэша без PNG `readyToken` не отдаёт (перерендер). */
  async revoke(token: string): Promise<void> {
    await this.redis.del(pngKey(token), bindingKey(token));
  }

  async storeFailed(hash: string): Promise<void> {
    await this.redis
      .multi()
      .set(failedKey(hash), '1', 'EX', STORY_CARD_POLICY.failedTtlSec)
      .del(pendingKey(hash))
      .exec();
  }
}
