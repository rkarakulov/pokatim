import { minskToday, OG_BRAND, type OgCardKind } from '@pokatim/contracts';

/**
 * Карточка для сторис (story-cards, ADR-0018): Redis-ключи с TTL, лимиты, задача рендера. **Изменил разметку, тексты
 * или токены карточки (`storyCard` в `@pokatim/design-tokens`, строки `storyCard.*`) — подними `renderVersion`**:
 * иначе до 24 ч отдаётся старая картинка (ключ кэша — хэш входов с версией).
 */
export const STORY_CARD_POLICY = {
  // 4 — ride-photo: 4a с фото организатора под затемнением (ADR-0028)
  // 5 — invites: адрес /i/<code> рядом с брендом (P6); карточки райда и маршрута стали личными (RC-P6-5)
  renderVersion: 5,
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

/** Вид картинки: виды объектов и бренд-картинка (`OG_BRAND`). */
export type OgCardKindOrBrand = OgCardKind | typeof OG_BRAND.kind;

/** Схема темы OG-картинки: `light` — «Линия», `dark` — «Ночь» (как шаблоны сторис). */
export type OgScheme = 'light' | 'dark';

/**
 * OG-картинки публичных страниц (og-images, ADR-0018; память Redis — вариант A R-A1): PNG в Redis по хэшу входов,
 * пререндер `og.sync`. **Изменил разметку, тексты или токены OG (`ogCard` в `@pokatim/design-tokens`, строки
 * `ogCard.*`) или таблицу `scheme` — подними `renderVersion`**: смена версии меняет хэши (новые URL картинок) и
 * запускает полный проход `og.sync` (смена `scheme` без версии меняет хэши, но полного прохода не даёт).
 */
export const OG_CARD_POLICY = {
  renderVersion: 3,
  /** схема темы по виду: соревновательные (гонка, сезон, райдер) — тёмная, остальные и бренд — светлая */
  scheme: {
    race: 'dark',
    ride: 'light',
    route: 'light',
    calendar: 'light',
    season: 'dark',
    rider: 'dark',
    brand: 'light',
  } satisfies Record<OgCardKindOrBrand, OgScheme>,
  /** PNG, с: 7 суток, продление при каждой выдаче 200 (`GETEX`) — живут только запрашиваемые картинки */
  pngTtlSec: 7 * 86_400,
  /** PNG объекта вне окна пререндера (самолечение по запросу), с: сутки; выдача продлевает до `pngTtlSec` */
  pngShortTtlSec: 86_400,
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
  prerenderWindow: { rideDays: 14, raceDays: 30, calendarDays: 14, seasonDays: 30 },
} as const;

/**
 * Виды пререндера `og.sync`: райдер не участвует (статистика меняется публикацией протоколов, а не `updatedAt`
 * профиля — только самолечение по запросу).
 */
export const OG_SYNC_KINDS = [
  'race',
  'ride',
  'route',
  'calendar',
  'season',
] as const satisfies readonly OgCardKind[];

/**
 * Виды с курсором `og:cursor:<kind>` по `(updatedAt, _id)`. Сезоны — без курсора: каждый прогон смотрит все «живые»
 * (число гонок сезона меняется без `updatedAt` сезона, RC-2a).
 */
export const OG_CURSOR_KINDS = [
  'race',
  'ride',
  'route',
  'calendar',
] as const satisfies readonly OgCardKind[];

/** Поля фактов, по которым решается «живой» объект (структурно — без импорта портов владельцев). */
export type OgPrerenderFacts =
  | { kind: 'race'; facts: { windowEndsAt: Date } }
  | { kind: 'ride'; facts: { startsAt: Date } }
  | { kind: 'calendar'; facts: { startsOn: string; endsOn: string | null } }
  | { kind: 'season'; facts: { endsOn: string } }
  | { kind: 'rider' }
  | { kind: 'route' }
  | { kind: 'brand' };

/**
 * Пререндерить ли картинку в `og.sync` (вариант A R-A1): райд — старт не раньше 14 сут. назад, гонка — окно
 * закрылось не раньше 30 сут. назад, старт календаря — последний день не раньше 14 сут. назад, сезон — последний
 * день не раньше 30 сут. назад (даты Минска); маршрут каталога и бренд — всегда; райдер — никогда (самолечение).
 */
export function ogPrerenderable(input: OgPrerenderFacts, now: Date): boolean {
  const { rideDays, raceDays, calendarDays, seasonDays } = OG_CARD_POLICY.prerenderWindow;
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
  switch (input.kind) {
    case 'ride':
      return input.facts.startsAt >= since(rideDays);
    case 'race':
      return input.facts.windowEndsAt >= since(raceDays);
    case 'calendar':
      return (input.facts.endsOn ?? input.facts.startsOn) >= minskToday(since(calendarDays));
    case 'season':
      return input.facts.endsOn >= minskToday(since(seasonDays));
    case 'rider':
      return false;
    case 'route':
    case 'brand':
      return true;
  }
}

/**
 * Карта сайта (landing-seo): `GET /v1/sitemap`. Лимит вида держит файл `sitemap.xml` в пределах 50 000 URL;
 * мемо процесса — прямые запросы к API не сканируют коллекции чаще раза в окно.
 */
export const SITEMAP_POLICY = {
  /** строк вида за один запрос к порту владельца */
  scanPage: 1_000,
  /** записей одного вида в карте */
  kindLimit: 10_000,
  /** окно мемо ответа, мс */
  memoMs: 10 * 60_000,
} as const;
