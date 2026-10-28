import { STORY_CARD_TEMPLATES, type StoryCardTemplate } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

/** Шаблоны карточки в порядке контракта и их подписи (чипы экрана). */
export const storyTemplates = STORY_CARD_TEMPLATES.map((template) => ({
  template,
  label: t(`story.template.${template}`),
}));

/** Опрос статуса карточки: раз в секунду, не дольше 30 с от первого `pending` — дальше ошибка с повтором. */
export const STORY_POLL_MS = 1000;
export const STORY_POLL_LIMIT_MS = 30_000;

/** Карточка не готова за `STORY_POLL_LIMIT_MS` или рендер не удался (`failed`) — экран: «Не удалось загрузить». */
export class StoryCardNotReady extends Error {
  constructor(readonly reason: 'timeout' | 'failed') {
    super(`story card ${reason}`);
    this.name = 'StoryCardNotReady';
  }
}

export type { StoryCardTemplate };
