import {
  type AchievementCode,
  type AchievementLevel,
  SEASON_REGULAR_MIN_RACES,
} from '@pokatim/contracts';
import { formatLocalRange, heroDateText, type MessageKey, t } from '@pokatim/i18n';

import { badgeCount } from './achievement-card.icons';
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

/**
 * Число условия (`{count}`): счётное — порог уровня (как число на значке); «Сезон в зачёте» — `SEASON_REGULAR_MIN_RACES`
 * контрактов (как `achievementCondition` приложения; смена константы — подъём `renderVersion`, RC-3); прочие — нет.
 */
function conditionCount(code: AchievementCode, level: AchievementLevel | null): number | undefined {
  return code === 'season_regular' ? SEASON_REGULAR_MIN_RACES : badgeCount(code, level);
}

/**
 * Тексты — строки каталога `achievements.*` (как экран достижения), дата факта с годом (день по Минску, RC-7). Счётное
 * (RC-L7): метка уровня в kicker, условие — порог уровня (`{count}`, как число на значке). Сезонное (C3): kicker без
 * уровня, объект — «Сезон «…»», дата — последний день сезона; мест и очков нет.
 */
export function achievementCardTexts(input: AchievementCardInput): AchievementCardTexts {
  const { facts } = input;
  const count = conditionCount(facts.code, facts.level);
  return {
    kicker:
      facts.level === null
        ? t('achievementCard.kicker')
        : t('achievementCard.kickerLevel', {
            level: t(`achievements.level.${facts.level}` as MessageKey),
          }),
    title: t(`achievements.${facts.code}.title` as MessageKey),
    condition: t(
      `achievements.${facts.code}.condition` as MessageKey,
      count === undefined ? undefined : { count },
    ),
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
