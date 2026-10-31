import {
  ACHIEVEMENT_LEVEL_TARGETS,
  ACHIEVEMENT_LEVELS,
  isLeveledCode,
  SEASON_REGULAR_MIN_RACES,
  type Achievement,
  type AchievementCode,
  type AchievementLevel,
  type AchievementObject,
  type PublicRiderAchievement,
} from '@pokatim/contracts';
import { heroDateText, t, formatLocalRange, type MessageKey } from '@pokatim/i18n';

import type { IconName } from '@/components/icon';

/** Достижение с известным этой сборке кодом (RC-8: `'unknown'` отброшен — его нельзя ни показать, ни пометить). */
export type KnownAchievement<T extends PublicRiderAchievement = Achievement> = T & {
  code: AchievementCode;
};

interface CatalogEntry {
  title: MessageKey;
  condition: MessageKey;
  icon: IconName;
  /** «Сторис результата» → сторис результата гонки объекта (A6) — только гоночные */
  shareable: boolean;
  /** виден в публичном профиле (A7, R9: публично — только протоколы) — гоночные и сезонные (S6) */
  public: boolean;
  /** «Поделиться» → карточка достижения для сторис (у сезонных — с сезоном, C1) */
  storyCard: boolean;
  /** выдача — на сезон, объект — сезон (S3): ключ — код + сезон, «К сезону» */
  seasonal: boolean;
}

const RACE = { shareable: true, public: true, storyCard: true, seasonal: false } as const;
const PRIVATE = { shareable: false, public: false, storyCard: true, seasonal: false } as const;
const SEASON = { shareable: false, public: true, storyCard: true, seasonal: true } as const;

/**
 * Каталог (A1): ключи i18n, значок, шеринг. Исчерпывающий: новый код contracts без строки — ошибка типов. Пороги уровней
 * счётных (число на значке, `{count}` условия) — `ACHIEVEMENT_LEVEL_TARGETS` контрактов, без копии здесь.
 */
export const ACHIEVEMENT_CATALOG = {
  race_first_finish: {
    title: 'achievements.race_first_finish.title',
    condition: 'achievements.race_first_finish.condition',
    icon: 'races',
    ...RACE,
  },
  race_podium: {
    title: 'achievements.race_podium.title',
    condition: 'achievements.race_podium.condition',
    icon: 'medal',
    ...RACE,
  },
  race_win: {
    title: 'achievements.race_win.title',
    condition: 'achievements.race_win.condition',
    icon: 'trophy',
    ...RACE,
  },
  races_5: {
    title: 'achievements.races_5.title',
    condition: 'achievements.races_5.condition',
    icon: 'races',
    ...RACE,
  },
  route_first: {
    title: 'achievements.route_first.title',
    condition: 'achievements.route_first.condition',
    icon: 'routes',
    ...PRIVATE,
  },
  routes_5: {
    title: 'achievements.routes_5.title',
    condition: 'achievements.routes_5.condition',
    icon: 'routes',
    ...PRIVATE,
  },
  ride_first: {
    title: 'achievements.ride_first.title',
    condition: 'achievements.ride_first.condition',
    icon: 'rides',
    ...PRIVATE,
  },
  ride_organizer: {
    title: 'achievements.ride_organizer.title',
    condition: 'achievements.ride_organizer.condition',
    icon: 'person',
    ...PRIVATE,
  },
  rides_10: {
    title: 'achievements.rides_10.title',
    condition: 'achievements.rides_10.condition',
    icon: 'rides',
    ...PRIVATE,
  },
  season_regular: {
    title: 'achievements.season_regular.title',
    condition: 'achievements.season_regular.condition',
    icon: 'calendar',
    ...SEASON,
  },
  season_podium: {
    title: 'achievements.season_podium.title',
    condition: 'achievements.season_podium.condition',
    icon: 'medal',
    ...SEASON,
  },
  season_champion: {
    title: 'achievements.season_champion.title',
    condition: 'achievements.season_champion.condition',
    icon: 'trophy',
    ...SEASON,
  },
} as const satisfies Record<AchievementCode, CatalogEntry>;

export const catalogEntry = (code: AchievementCode): CatalogEntry => ACHIEVEMENT_CATALOG[code];
export const achievementTitle = (code: AchievementCode) => t(catalogEntry(code).title);

/** Уровень из ответа (`Achievement.level`: строка, `'unknown'` или `null`). */
type ResponseLevel = Achievement['level'];

/**
 * Показываемый уровень (RC-L8): счётное без уровня (старый API выдавал только бронзу) — бронза; незнакомый уровень —
 * без уровня; разовое — без уровня.
 */
export function displayLevel(code: AchievementCode, level: ResponseLevel): AchievementLevel | null {
  if (!isLeveledCode(code) || level === 'unknown') return null;
  return level ?? 'bronze';
}

/** Число на значке (L6): порог показываемого уровня; незнакомый уровень и разовые — без числа. */
export function badgeCount(code: AchievementCode, level: ResponseLevel): number | undefined {
  const shown = displayLevel(code, level);
  if (shown === null || !isLeveledCode(code)) return undefined;
  return ACHIEVEMENT_LEVEL_TARGETS[code][ACHIEVEMENT_LEVELS.indexOf(shown)];
}

/**
 * Условие (L6): для текущего уровня («Финиш в зачёте 15 разных гонок»); незнакомый уровень — порог бронзы. «Сезон в
 * зачёте» — порог `SEASON_REGULAR_MIN_RACES` контрактов (без копии).
 */
export function achievementCondition(code: AchievementCode, level: ResponseLevel): string {
  if (code === 'season_regular')
    return t(catalogEntry(code).condition, { count: SEASON_REGULAR_MIN_RACES });
  if (!isLeveledCode(code)) return t(catalogEntry(code).condition);
  const count = badgeCount(code, level) ?? ACHIEVEMENT_LEVEL_TARGETS[code][0];
  return t(catalogEntry(code).condition, { count });
}

const LEVEL_TEXT = {
  bronze: 'achievements.level.bronze',
  silver: 'achievements.level.silver',
  gold: 'achievements.level.gold',
} as const satisfies Record<AchievementLevel, MessageKey>;

/** Метка уровня: «Бронза», «Серебро», «Золото» (уровень текстом, не цветом). */
export const levelLabel = (level: AchievementLevel) => t(LEVEL_TEXT[level]);

/** Метка показываемого уровня элемента; разовое и незнакомый уровень — `null`. */
export function itemLevelLabel(item: KnownAchievement<PublicRiderAchievement>): string | null {
  const shown = displayLevel(item.code, item.level);
  return shown === null ? null : levelLabel(shown);
}

/** Вспышка повышения — «Новый уровень» (серебро и золото); бронза, незнакомый и без уровня — «Новое достижение». */
export const isLevelUp = (item: Pick<Achievement, 'level'>) =>
  item.level === 'silver' || item.level === 'gold';

/**
 * Ключ элемента (S3): у сезонных — код и сезон (один код за разные сезоны — разные выдачи), у прочих — код. Ключ React
 * плиток, поиска на экране и оптимистичной пометки `seen`.
 */
export const achievementKey = (item: Pick<PublicRiderAchievement, 'code' | 'object'>) =>
  item.object.kind === 'season' ? `${item.code}:${item.object.id}` : item.code;

/**
 * Ключ сессии вспышки (RC-L4): ключ элемента и уровень — бронза, показанная в этом запуске, не скрывает серебро,
 * «Призёр» одного сезона — «Призёра» другого. `POST seen` — по `seenTarget`.
 */
export const flashKey = (item: Pick<Achievement, 'code' | 'level' | 'object'>) =>
  `${achievementKey(item)}:${item.level ?? ''}`;

/** Адрес `POST seen`: сезонные — код и сезон, прочие — код (`seasonId: null`). */
export interface SeenTarget {
  code: AchievementCode;
  seasonId: string | null;
}
export const seenTarget = (item: KnownAchievement<PublicRiderAchievement>): SeenTarget => ({
  code: item.code,
  seasonId: item.object.kind === 'season' ? item.object.id : null,
});

/** Экран своего достижения по коду и сезону: `/achievements/<code>`, у сезонных — `?season=<id>`. */
export const achievementPath = (code: PublicRiderAchievement['code'], seasonId: string | null) =>
  seasonId === null
    ? `/achievements/${code}`
    : `/achievements/${code}?season=${encodeURIComponent(seasonId)}`;

/** Экран своего достижения: `/achievements/<code>`, у сезонных — `?season=<id>`. */
export const achievementItemPath = (item: Pick<PublicRiderAchievement, 'code' | 'object'>) =>
  achievementPath(item.code, item.object.kind === 'season' ? item.object.id : null);

/** Сезон объекта для «К сезону» (S7); не сезон — `null`. */
export const seasonOf = (item: Pick<PublicRiderAchievement, 'object'>): string | null =>
  item.object.kind === 'season' ? item.object.id : null;

/** Только известные коды, порядок сервера (от новых фактов к старым) сохраняется (RC-8). */
export function knownItems<T extends PublicRiderAchievement>(
  items: readonly T[],
): KnownAchievement<T>[] {
  return items.filter((item): item is KnownAchievement<T> => item.code !== 'unknown');
}

/**
 * Очередь вспышки (A5): неувиденные известные — от старых к новым (обратный порядок ответа). `shown` — ключи
 * `flashKey`, уже показанные в этом запуске: сбой `seen` вернёт `seen: false` в кэш, но вспышка не зациклится.
 */
export function flashQueue(
  items: readonly Achievement[],
  shown: ReadonlySet<string> = new Set(),
): KnownAchievement[] {
  return knownItems(items)
    .filter((item) => !item.seen && !shown.has(flashKey(item)))
    .reverse();
}

/**
 * Только достижения публичного профиля (A7, S6): гоночные и сезонные; прочие — защита от регресса API, сервер их не
 * отдаёт.
 */
export const publicItems = <T extends PublicRiderAchievement>(
  items: readonly KnownAchievement<T>[],
) => items.filter((item) => catalogEntry(item.code).public);

/** Гонка для «Сторис результата» (A6): только гоночный код и объект-гонка; незнакомый вид — без кнопки (RC-8). */
export const shareRaceId = (item: KnownAchievement<PublicRiderAchievement>): string | null =>
  catalogEntry(item.code).shareable && item.object.kind === 'race' ? item.object.id : null;

const OBJECT_TEXT = {
  race: 'achievements.object.race',
  route: 'achievements.object.route',
  ride: 'achievements.object.ride',
  season: 'achievements.object.season',
} as const satisfies Record<Exclude<AchievementObject['kind'], 'unknown'>, MessageKey>;

/** «Гонка «…»», «Маршрут «…»», «Кофе-райд «…»», «Сезон «…»»; незнакомый вид — только название. */
export const achievementObjectText = (object: AchievementObject) =>
  object.kind === 'unknown' ? object.title : t(OBJECT_TEXT[object.kind], { title: object.title });

/** Дата факта (день по Минску, RC-7) — всегда с годом: одинаково на SSR и после гидрации. */
export const factDateText = (factDate: string) =>
  heroDateText(formatLocalRange(factDate, factDate, null));

/**
 * Подпись a11y значка и экрана: «Достижение «Победа»: Гонка «…», 2 мая 2026»; счётное — с уровнем («Достижение
 * «Гонщик», серебро: …»).
 */
export function achievementA11y(item: KnownAchievement<PublicRiderAchievement>): string {
  const params = {
    title: achievementTitle(item.code),
    object: achievementObjectText(item.object),
    date: factDateText(item.factDate),
  };
  const level = itemLevelLabel(item);
  return level === null
    ? t('achievements.a11y', params)
    : t('achievements.a11yLevel', { ...params, level: level.toLocaleLowerCase('ru') });
}
