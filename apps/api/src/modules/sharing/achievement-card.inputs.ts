import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AchievementCode, AppThemeId, StoryCardTemplate } from '@pokatim/contracts';

import {
  type AchievementCardFacts,
  ACHIEVEMENTS_FOR_SHARING,
  type AchievementsForSharing,
} from '../achievements';
import { RIDER_NAMES, type RiderNameDirectory, RIDER_THEMES, type RiderThemes } from '../profile';
import { ROUTES_FOR_SHARING, type RoutesForSharing } from '../routes';
import { STORY_CARD_POLICY } from './sharing.policy';

/** Всё, от чего зависит карточка достижения. */
export interface AchievementCardInput {
  template: StoryCardTemplate;
  themeId: AppThemeId;
  facts: AchievementCardFacts;
  /** название объекта на картинке: гонка и райд — всегда, маршрут — только из каталога; иначе `null` (R5) */
  objectTitle: string | null;
  /** имя только с согласием (`RIDER_NAMES.publicNames`); нет — `null` */
  riderName: string | null;
}

/**
 * Ключ кэша: sha256 hex канонического JSON (вид карточки — ключи кэша общие со сторис гонки и приглашением, версия
 * рендера, шаблон, тема, код, уровень, объект и его публичное название, дата факта, имя). Смена любого — новая картинка.
 */
export function achievementCardHash(input: AchievementCardInput): string {
  const { facts } = input;
  const canonical = [
    'achievement',
    STORY_CARD_POLICY.renderVersion,
    input.template,
    input.themeId,
    facts.code,
    facts.level,
    facts.object.kind,
    facts.object.id,
    input.objectTitle,
    facts.factDate,
    input.riderName,
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Входы карточки достижения — одна реализация для HTTP (статус) и worker (сверка «устарело»): своё полученное
 * достижение (порт `achievements`; нет — `null`), публичное название объекта (маршрут — только каталог, порт
 * `routes`), тема и имя с согласием владельца (`profile`).
 */
@Injectable()
export class AchievementCardInputs {
  constructor(
    @Inject(ACHIEVEMENTS_FOR_SHARING) private readonly achievements: AchievementsForSharing,
    @Inject(ROUTES_FOR_SHARING) private readonly routes: RoutesForSharing,
    @Inject(RIDER_THEMES) private readonly themes: RiderThemes,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
  ) {}

  async resolve(
    userId: string,
    code: AchievementCode,
    template: StoryCardTemplate,
  ): Promise<{ input: AchievementCardInput; hash: string } | null> {
    const facts = await this.achievements.cardFacts(userId, code);
    if (!facts) return null;
    const [objectTitle, themeId, names] = await Promise.all([
      this.publicTitle(facts.object),
      this.themes.themeOf(userId),
      this.names.publicNames([userId]),
    ]);
    const input: AchievementCardInput = {
      template,
      themeId,
      facts,
      objectTitle,
      riderName: names.get(userId) ?? null,
    };
    return { input, hash: achievementCardHash(input) };
  }

  /** Свой приватный маршрут (и снятый с каталога) на картинку не попадает — картинка уходит наружу. */
  private async publicTitle(object: AchievementCardFacts['object']): Promise<string | null> {
    if (object.kind !== 'route') return object.title;
    return (await this.routes.ogFacts(object.id))?.title ?? null;
  }
}
