import type {
  Achievement,
  AchievementCode,
  AchievementObject,
  PublicRiderAchievement,
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
  /** число на значке («Пять гонок», «Десять кофе-райдов») */
  count?: number;
  /** «Поделиться» → сторис результата гонки объекта (A6) — только гоночные */
  shareable: boolean;
}

/** Каталог v1 (A1): ключи i18n, значок, шеринг. Исчерпывающий: новый код contracts без строки — ошибка типов. */
export const ACHIEVEMENT_CATALOG = {
  race_first_finish: {
    title: 'achievements.race_first_finish.title',
    condition: 'achievements.race_first_finish.condition',
    icon: 'races',
    shareable: true,
  },
  race_podium: {
    title: 'achievements.race_podium.title',
    condition: 'achievements.race_podium.condition',
    icon: 'medal',
    shareable: true,
  },
  race_win: {
    title: 'achievements.race_win.title',
    condition: 'achievements.race_win.condition',
    icon: 'trophy',
    shareable: true,
  },
  races_5: {
    title: 'achievements.races_5.title',
    condition: 'achievements.races_5.condition',
    icon: 'races',
    count: 5,
    shareable: true,
  },
  route_first: {
    title: 'achievements.route_first.title',
    condition: 'achievements.route_first.condition',
    icon: 'routes',
    shareable: false,
  },
  routes_5: {
    title: 'achievements.routes_5.title',
    condition: 'achievements.routes_5.condition',
    icon: 'routes',
    count: 5,
    shareable: false,
  },
  ride_first: {
    title: 'achievements.ride_first.title',
    condition: 'achievements.ride_first.condition',
    icon: 'rides',
    shareable: false,
  },
  ride_organizer: {
    title: 'achievements.ride_organizer.title',
    condition: 'achievements.ride_organizer.condition',
    icon: 'person',
    shareable: false,
  },
  rides_10: {
    title: 'achievements.rides_10.title',
    condition: 'achievements.rides_10.condition',
    icon: 'rides',
    count: 10,
    shareable: false,
  },
} as const satisfies Record<AchievementCode, CatalogEntry>;

export const catalogEntry = (code: AchievementCode): CatalogEntry => ACHIEVEMENT_CATALOG[code];
export const achievementTitle = (code: AchievementCode) => t(catalogEntry(code).title);
export const achievementCondition = (code: AchievementCode) => t(catalogEntry(code).condition);

/** Только известные коды, порядок сервера (от новых фактов к старым) сохраняется (RC-8). */
export function knownItems<T extends PublicRiderAchievement>(
  items: readonly T[],
): KnownAchievement<T>[] {
  return items.filter((item): item is KnownAchievement<T> => item.code !== 'unknown');
}

/**
 * Очередь вспышки (A5): неувиденные известные — от старых к новым (обратный порядок ответа). `shown` — коды, уже
 * показанные в этом запуске: сбой `seen` вернёт `seen: false` в кэш, но вспышка не зациклится.
 */
export function flashQueue(
  items: readonly Achievement[],
  shown: ReadonlySet<string> = new Set(),
): KnownAchievement[] {
  return knownItems(items)
    .filter((item) => !item.seen && !shown.has(item.code))
    .reverse();
}

/** Гонка для «Поделиться» (A6): только гоночный код и объект-гонка; незнакомый вид — без кнопки (RC-8). */
export const shareRaceId = (item: KnownAchievement<PublicRiderAchievement>): string | null =>
  catalogEntry(item.code).shareable && item.object.kind === 'race' ? item.object.id : null;

const OBJECT_TEXT = {
  race: 'achievements.object.race',
  route: 'achievements.object.route',
  ride: 'achievements.object.ride',
} as const satisfies Record<Exclude<AchievementObject['kind'], 'unknown'>, MessageKey>;

/** «Гонка «…»», «Маршрут «…»», «Кофе-райд «…»»; незнакомый вид — только название. */
export const achievementObjectText = (object: AchievementObject) =>
  object.kind === 'unknown' ? object.title : t(OBJECT_TEXT[object.kind], { title: object.title });

/** Дата факта (день по Минску, RC-7) — всегда с годом: одинаково на SSR и после гидрации. */
export const factDateText = (factDate: string) =>
  heroDateText(formatLocalRange(factDate, factDate, null));

/** Подпись a11y значка и экрана: «Достижение «Победа»: Гонка «…», 2 мая 2026». */
export const achievementA11y = (item: KnownAchievement<PublicRiderAchievement>) =>
  t('achievements.a11y', {
    title: achievementTitle(item.code),
    object: achievementObjectText(item.object),
    date: factDateText(item.factDate),
  });
