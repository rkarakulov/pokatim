import { minskToday } from '@pokatim/contracts';

/**
 * Карточка для сторис (story-cards, ADR-0018): Redis-ключи с TTL, лимиты, задача рендера. **Изменил разметку, тексты
 * или токены карточки (`storyCard` в `@pokatim/design-tokens`, строки `storyCard.*`) — подними `renderVersion`**:
 * иначе до 24 ч отдаётся старая картинка (ключ кэша — хэш входов с версией).
 */
export const STORY_CARD_POLICY = {
  renderVersion: 2,
  /** PNG и ключ хэш → токен, с */
  pngTtlSec: 86_400,
  /** ключ постановки рендера (NX), с */
  pendingTtlSec: 120,
  /** отметка провала рендера (читается `GETDEL` — сообщается один раз), с */
  failedTtlSec: 600,
  maxPngBytes: 2_000_000,
  /** чтение статуса на пользователя (опрос 1/с × 30 с × 2 шаблона) */
  readLimit: { limit: 120, windowSec: 60 },
  /** постановок рендера на пользователя — списывается только при захвате ключа постановки */
  renderLimit: { limit: 30, windowSec: 3600 },
  /** выдача PNG по IP */
  imageIpLimit: { limit: 120, windowSec: 60 },
  jobAttempts: 2,
  jobBackoffMs: 2_000,
} as const;

const DAY_MS = 86_400_000;

/**
 * OG-картинки публичных страниц (og-images, ADR-0018; память Redis — вариант A R-A1): PNG в Redis по хэшу входов,
 * пререндер `og.sync`. **Изменил разметку, тексты или токены OG (`ogCard` в `@pokatim/design-tokens`, строки
 * `ogCard.*`) — подними `renderVersion`**: смена версии меняет хэши (новые URL картинок) и запускает полный проход
 * `og.sync`.
 */
export const OG_CARD_POLICY = {
  renderVersion: 1,
  /** PNG, с: 7 суток, продление при каждой выдаче 200 (`GETEX`) — живут только запрашиваемые картинки */
  pngTtlSec: 7 * 86_400,
  /** ключ постановки рендера (NX), с */
  pendingTtlSec: 120,
  /** удержание ключа постановки после финального провала рендера — троттлинг самолечения, с */
  failedHoldSec: 600,
  maxPngBytes: 300_000,
  /** версия картинки для SSR — свой бакет: web-сервер ходит с одного IP */
  cardsIpLimit: { limit: 300, windowSec: 60 },
  /** выдача PNG по IP */
  imageIpLimit: { limit: 300, windowSec: 60 },
  /** строк одного вида за прогон `og.sync` */
  syncScanLimit: 200,
  /** постановок рендера за прогон `og.sync` (остаток — следующим прогоном) */
  syncRenderLimit: 60,
  /** приоритет задач `og-card.render` в очереди `story-card`: задачи без приоритета (сторис) берутся раньше */
  jobPriority: 10,
  jobAttempts: 2,
  jobBackoffMs: 2_000,
  /** пререндер только «живых» объектов, сут.; остальные — самолечением при первом запросе */
  prerenderWindow: { rideDays: 14, raceDays: 30, calendarDays: 14 },
} as const;

/** Поля фактов, по которым решается «живой» объект (структурно — без импорта портов владельцев). */
export type OgPrerenderFacts =
  | { kind: 'race'; facts: { windowEndsAt: Date } }
  | { kind: 'ride'; facts: { startsAt: Date } }
  | { kind: 'calendar'; facts: { startsOn: string; endsOn: string | null } }
  | { kind: 'route' }
  | { kind: 'brand' };

/**
 * Пререндерить ли картинку в `og.sync` (вариант A R-A1): райд — старт не раньше 14 сут. назад, гонка — окно
 * закрылось не раньше 30 сут. назад, старт календаря — последний день не раньше 14 сут. назад (даты Минска);
 * маршрут каталога и бренд — всегда.
 */
export function ogPrerenderable(input: OgPrerenderFacts, now: Date): boolean {
  const { rideDays, raceDays, calendarDays } = OG_CARD_POLICY.prerenderWindow;
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
  switch (input.kind) {
    case 'ride':
      return input.facts.startsAt >= since(rideDays);
    case 'race':
      return input.facts.windowEndsAt >= since(raceDays);
    case 'calendar':
      return (input.facts.endsOn ?? input.facts.startsOn) >= minskToday(since(calendarDays));
    case 'route':
    case 'brand':
      return true;
  }
}
