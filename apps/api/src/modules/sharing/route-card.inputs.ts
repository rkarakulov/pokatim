import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AppThemeId, StoryCardTemplate } from '@pokatim/contracts';

import { RIDER_THEMES, type RiderThemes } from '../profile';
import { type RouteOgFacts, ROUTES_FOR_SHARING, type RoutesForSharing } from '../routes';
import { STORY_CARD_POLICY } from './sharing.policy';

/** Всё, от чего зависит карточка маршрута (линию представляет `facts.routeId` — маршрут каталога неизменен). */
export interface RouteCardInput {
  template: StoryCardTemplate;
  themeId: AppThemeId;
  facts: RouteOgFacts;
  /** короткая ссылка приглашения владельца карточки (`InviteAddress`, P6); считает HTTP, worker берёт из задачи */
  address: string | null;
}

/**
 * Ключ кэша карточки маршрута: sha256 hex канонического JSON (вид карточки — ключи кэша общие с другими карточками,
 * версия рендера, шаблон, тема, поля маршрута на карточке). Зрителя в ключе нет — картинка одна на тему (тема —
 * запрашивающего карточку, user-theme).
 */
export function routeCardHash(input: RouteCardInput): string {
  const { facts } = input;
  const canonical = [
    'route-card',
    STORY_CARD_POLICY.renderVersion,
    input.template,
    input.address,
    input.themeId,
    facts.routeId,
    facts.title,
    facts.distanceM,
    facts.elevationGainM,
    facts.isLoop,
    facts.city,
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Входы карточки маршрута — одна реализация для HTTP (статус) и worker (сверка «устарело»): факты маршрута **в
 * каталоге** (порт `routes` `ogFacts`; не в каталоге — `null`) и тема запрашивающего (`profile`, user-theme).
 */
@Injectable()
export class RouteCardInputs {
  constructor(
    @Inject(ROUTES_FOR_SHARING) private readonly routes: RoutesForSharing,
    @Inject(RIDER_THEMES) private readonly themes: RiderThemes,
  ) {}

  async resolve(
    userId: string,
    routeId: string,
    template: StoryCardTemplate,
    address: string | null,
  ): Promise<{ input: RouteCardInput; hash: string } | null> {
    const facts = await this.routes.ogFacts(routeId);
    if (!facts) return null;
    const input: RouteCardInput = {
      template,
      themeId: await this.themes.themeOf(userId),
      facts,
      address,
    };
    return { input, hash: routeCardHash(input) };
  }
}
