import { utcToMinskWallTime } from '@pokatim/contracts';
import {
  formatElapsed,
  formatLocalRange,
  formatPlace,
  heroDateText,
  type MessageKey,
  t,
} from '@pokatim/i18n';

import type { StoryCardInput } from './story-card.inputs';

/** Тексты карточки (регистр — `uppercase` токенов `storyCard.text`, не строки словаря). */
export interface StoryCardTexts {
  kicker: string;
  title: string;
  /** имя с согласием; нет — строки на карточке нет */
  riderName: string | null;
  date: string;
  time: string;
  /** место «3» / «=3»; без места (`finisher`) — `null`, пара показывает только группу */
  place: string | null;
  placeLabel: string;
  group: string;
  groupLabel: string;
  brand: string;
}

const minskDate = (at: Date) => utcToMinskWallTime(at.toISOString()).slice(0, 10);

/**
 * Тексты из фактов — общими форматтерами `@pokatim/i18n` (как приложение): метка «Гонка» / «Гонка · Предварительный»
 * (до публикации протокола — и у финишёра), окно гонки по Минску с годом (`now = null`; дата своего заезда не раскрывается — RC-3),
 * время «Ч:ММ:СС», место «=N», подпись группы.
 */
export function storyCardTexts(input: StoryCardInput): StoryCardTexts {
  const { facts } = input;
  const window = formatLocalRange(
    minskDate(facts.race.windowStartsAt),
    minskDate(facts.race.windowEndsAt),
    null,
  );
  return {
    kicker: t(facts.provisional ? 'storyCard.kickerProvisional' : 'storyCard.kicker'),
    title: facts.race.title,
    riderName: input.riderName,
    date: heroDateText(window),
    time: formatElapsed(facts.elapsedSec),
    place: facts.place === null ? null : formatPlace(facts.place, facts.tied),
    placeLabel: t('storyCard.place'),
    group: t(`results.group.${facts.group}` as MessageKey),
    groupLabel: t('storyCard.group'),
    brand: t('storyCard.brand'),
  };
}
