import { formatLocalRange, heroDateText, type MessageKey, t } from '@pokatim/i18n';

import type { AchievementCardInput } from './achievement-card.inputs';

/** Тексты карточки достижения (регистр — `uppercase` токенов `storyCard.text`, не строки словаря). */
export interface AchievementCardTexts {
  kicker: string;
  title: string;
  condition: string;
  /** «Гонка «…»»; объект не публичный — `null`, строки нет */
  object: string | null;
  /** имя с согласием; нет — строки нет */
  riderName: string | null;
  date: string;
  brand: string;
}

/** Тексты — строки каталога `achievements.*` (как экран достижения), дата факта с годом (день по Минску, RC-7). */
export function achievementCardTexts(input: AchievementCardInput): AchievementCardTexts {
  const { facts } = input;
  return {
    kicker: t('achievementCard.kicker'),
    title: t(`achievements.${facts.code}.title` as MessageKey),
    condition: t(`achievements.${facts.code}.condition` as MessageKey),
    object:
      input.objectTitle === null
        ? null
        : t(`achievements.object.${facts.object.kind}` as MessageKey, {
            title: input.objectTitle,
          }),
    riderName: input.riderName,
    date: heroDateText(formatLocalRange(facts.factDate, facts.factDate, null)),
    brand: t('storyCard.brand'),
  };
}
