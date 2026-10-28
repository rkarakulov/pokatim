import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AppThemeId, StoryCardTemplate } from '@pokatim/contracts';

import { APP_APPEARANCE, type AppAppearanceSource } from '../appearance';
import { type RideInviteFacts, RIDES_FOR_SHARING, type RidesForSharing } from '../rides';
import { STORY_CARD_POLICY } from './sharing.policy';

/** Всё, от чего зависит карточка-приглашение (линию представляет `facts.routeId` — маршрут каталога неизменен). */
export interface RideInviteInput {
  template: StoryCardTemplate;
  themeId: AppThemeId;
  facts: RideInviteFacts;
}

/**
 * Ключ кэша приглашения: sha256 hex канонического JSON (вид карточки — ключи кэша общие со сторис гонки, версия
 * рендера, шаблон, тема, поля райда на карточке, публичный маршрут). Зрителя в ключе нет — картинка у всех одна.
 */
export function rideInviteHash(input: RideInviteInput): string {
  const { facts } = input;
  const canonical = [
    'ride-invite',
    STORY_CARD_POLICY.renderVersion,
    input.template,
    input.themeId,
    facts.rideId,
    facts.title,
    facts.startsAt.toISOString(),
    facts.place,
    facts.distanceKm,
    facts.paceMinKmh,
    facts.paceMaxKmh,
    facts.routeId,
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Входы приглашения — одна реализация для HTTP (статус) и worker (сверка «устарело»): факты райда (порт `rides`;
 * скрытый и неизвестный — 404, не будущий — `null`) и активная тема.
 */
@Injectable()
export class RideInviteInputs {
  constructor(
    @Inject(RIDES_FOR_SHARING) private readonly rides: RidesForSharing,
    @Inject(APP_APPEARANCE) private readonly appearance: AppAppearanceSource,
  ) {}

  async resolve(
    userId: string,
    rideId: string,
    template: StoryCardTemplate,
  ): Promise<{ input: RideInviteInput; hash: string } | null> {
    const facts = await this.rides.inviteFacts(userId, rideId);
    if (!facts) return null;
    const input: RideInviteInput = {
      template,
      themeId: await this.appearance.activeThemeId(),
      facts,
    };
    return { input, hash: rideInviteHash(input) };
  }
}
