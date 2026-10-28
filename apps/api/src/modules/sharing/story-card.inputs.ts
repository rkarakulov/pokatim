import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AppThemeId, StoryCardTemplate } from '@pokatim/contracts';

import { APP_APPEARANCE, type AppAppearanceSource } from '../appearance';
import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { RESULTS_FOR_SHARING, type ResultsForSharing, type StoryCardFacts } from '../results';
import { STORY_CARD_POLICY } from './sharing.policy';

/** Всё, от чего зависит картинка (кроме координат линии — их представляет разметка попытки в `facts.attempt`). */
export interface StoryCardInput {
  template: StoryCardTemplate;
  themeId: AppThemeId;
  facts: StoryCardFacts;
  /** имя только с согласием (`RIDER_NAMES.publicNames`); нет — `null` */
  riderName: string | null;
}

/**
 * Ключ кэша карточки: sha256 hex канонического JSON входов (версия рендера, шаблон, тема, имя, заявка, статус, время,
 * место, ничья, группа, название и окно гонки, маршрут, попытка и её ревизия проверки и разметка). Смена любого —
 * новая картинка; `renderVersion` — смена разметки или текстов.
 */
export function storyCardHash(input: StoryCardInput): string {
  const { facts } = input;
  const canonical = [
    STORY_CARD_POLICY.renderVersion,
    input.template,
    input.themeId,
    input.riderName,
    facts.entryId,
    facts.status,
    facts.elapsedSec,
    facts.place,
    facts.tied,
    facts.group,
    facts.race.title,
    facts.race.windowStartsAt.toISOString(),
    facts.race.windowEndsAt.toISOString(),
    facts.race.routeId,
    facts.attempt && [
      facts.attempt.id,
      facts.attempt.checkRevision,
      facts.attempt.segment,
      facts.attempt.linePoints,
    ],
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Входы карточки — одна реализация для HTTP (статус) и worker (сверка «устарело»): факты своего результата (порт
 * `results`; 404/`null`), активная тема (`appearance`), имя с согласием (`profile`).
 */
@Injectable()
export class StoryCardInputs {
  constructor(
    @Inject(RESULTS_FOR_SHARING) private readonly results: ResultsForSharing,
    @Inject(APP_APPEARANCE) private readonly appearance: AppAppearanceSource,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
  ) {}

  async resolve(
    userId: string,
    raceId: string,
    template: StoryCardTemplate,
  ): Promise<{ input: StoryCardInput; hash: string } | null> {
    const facts = await this.results.storyCardFacts(userId, raceId);
    if (!facts) return null;
    const [themeId, names] = await Promise.all([
      this.appearance.activeThemeId(),
      this.names.publicNames([userId]),
    ]);
    const input: StoryCardInput = {
      template,
      themeId,
      facts,
      riderName: names.get(userId) ?? null,
    };
    return { input, hash: storyCardHash(input) };
  }
}
