import { type MessageKey, t } from '@pokatim/i18n';
import {
  type AchievementCode,
  type AchievementObjectKind,
  type DisputeOutcome,
  type NotificationKind,
  PLATFORM_TIME_ZONE,
  type RouteRejectionReason,
} from '@pokatim/contracts';

/**
 * Словарь текстов уведомлений (RC-9, «Тексты v1» `docs/product/notifications.md`). Строки сервера живут в модуле, как
 * письма identity и `error-messages.ts`; исключение (achievements-push, RC-P5) — имена достижений, уровней и объектов
 * берутся из каталога `@pokatim/i18n` (`achievements.*`, как карточка достижения `sharing`), второго каталога нет.
 * Текст рендерится при создании и хранится снимком. Только название гонки, райда или маршрута, дата, число, код причины — без имён и текстов других райдеров (N12). Даты — по Минску.
 */
export type NoticeText =
  | { kind: 'result_counted' | 'result_rejected'; race: string; activityAt: Date }
  | {
      kind:
        | 'protocol_published'
        | 'protocol_disqualified'
        | 'protocol_restored'
        | 'protocol_rechecked'
        | 'dispute_filed'
        | 'dispute_withdrawn'
        | 'dispute_responded';
      race: string;
    }
  | { kind: 'dispute_decided'; race: string; outcome: DisputeOutcome }
  | { kind: 'ride_cancelled' | 'ride_rescheduled'; ride: string; startsAt: Date }
  | { kind: 'ride_joined'; ride: string; goingCount: number }
  | { kind: 'ride_report_resolved'; ride: string }
  | { kind: 'route_published'; route: string }
  | { kind: 'route_rejected'; route: string; reason: RouteRejectionReason }
  /** напоминание о событии с билетом (PR D): текст правила — организатора, не ПДн райдеров */
  | { kind: 'event_reminder'; event: string; startsAt: Date; place: string | null; text: string }
  | { kind: 'profile_name_reset' | 'profile_club_reset' }
  | { kind: 'profile_avatar_reset'; blockedUntil: Date | null }
  /** новое достижение, уровень (ранг 2–3 — «Новый уровень») или сезонное; объект — свой (гонка, маршрут, райд, сезон) */
  | {
      kind: 'achievement_granted';
      code: AchievementCode;
      level: 1 | 2 | 3 | null;
      objectKind: AchievementObjectKind;
      objectTitle: string;
    };

export interface RenderedText {
  title: string;
  body: string;
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', {
  timeZone: PLATFORM_TIME_ZONE,
  day: 'numeric',
  month: 'long',
});
const hourMinute = new Intl.DateTimeFormat('ru-RU', {
  timeZone: PLATFORM_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** «14 июня». */
const day = (at: Date) => dayMonth.format(at);
/** «14 июня, 10:00». */
const dayTime = (at: Date) => `${dayMonth.format(at)}, ${hourMinute.format(at)}`;
/** Название в кавычках «…»: снимок — одна строка. */
const quoted = (name: string) => `«${name.replace(/\s+/g, ' ').trim()}»`;

/** Одна строка: пробелы и переводы строк схлопываются. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const LEVEL_KEYS = ['bronze', 'silver', 'gold'] as const;

/**
 * Заголовок о новом достижении (P5, RC-P2): ранг ≥ 2 — «Новый уровень: Гонщик · Серебро» (как вспышка `isLevelUp`),
 * иначе — «Новое достижение: Подиум» (счётное на бронзе и сезонное — тоже).
 */
function achievementTitle(input: Extract<NoticeText, { kind: 'achievement_granted' }>): string {
  const name = t(`achievements.${input.code}.title` as MessageKey);
  if (input.level !== null && input.level >= 2) {
    const level = t(`achievements.level.${LEVEL_KEYS[input.level - 1]}` as MessageKey);
    return `${t('achievements.flash.levelUp')}: ${name} · ${level}`;
  }
  return `${t('achievements.flash.kicker')}: ${name}`;
}

const OUTCOME: Record<DisputeOutcome, string> = {
  upheld: 'удовлетворён',
  rejected: 'отклонён',
};

/** Причина отклонения заявки маршрута; «Другое» — без подписи: комментарий модератора — только на карточке (N12). */
const REJECTION: Record<RouteRejectionReason, string> = {
  dangerous: 'Причина — опасный маршрут.',
  impassable: 'Причина — непроезжий или неточный.',
  duplicate: 'Причина — такой маршрут уже есть в каталоге.',
  bad_title: 'Причина — неподходящее название.',
  not_cycling: 'Причина — не велосипедный маршрут.',
  other: 'Подробности — в карточке маршрута.',
};

const TITLES: Record<Exclude<NotificationKind, 'achievement_granted'>, string> = {
  result_counted: 'Результат засчитан',
  result_rejected: 'Результат не засчитан',
  protocol_published: 'Протокол опубликован',
  protocol_disqualified: 'Протокол изменён',
  protocol_restored: 'Протокол изменён',
  protocol_rechecked: 'Протокол пересчитан',
  dispute_filed: 'На ваш результат подан спор',
  dispute_withdrawn: 'Спор отозван',
  dispute_responded: 'Ответ на ваш спор',
  dispute_decided: 'Решение по спору',
  ride_cancelled: 'Райд отменён',
  ride_rescheduled: 'Райд перенесён',
  ride_joined: 'Новый участник',
  ride_report_resolved: 'Жалоба рассмотрена',
  route_published: 'Маршрут опубликован',
  route_rejected: 'Маршрут отклонён',
  event_reminder: 'Скоро старт',
  profile_name_reset: 'Имя в профиле сброшено',
  profile_avatar_reset: 'Фото профиля удалено',
  profile_club_reset: 'Клуб в профиле сброшен',
};

function bodyOf(input: NoticeText): string {
  switch (input.kind) {
    case 'result_counted':
      return `${quoted(input.race)}: заезд ${day(input.activityAt)} засчитан.`;
    case 'result_rejected':
      return `${quoted(input.race)}: заезд ${day(input.activityAt)} не засчитан. Причина — на карточке гонки.`;
    case 'protocol_published':
      return `${quoted(input.race)}: итоговый протокол готов.`;
    case 'protocol_disqualified':
      return `${quoted(input.race)}: ваш результат снят с протокола.`;
    case 'protocol_restored':
      return `${quoted(input.race)}: ваш результат восстановлен в протоколе.`;
    case 'protocol_rechecked':
      return `${quoted(input.race)}: протокол пересчитан после перепроверки треков.`;
    case 'dispute_filed':
      return `${quoted(input.race)}: вы можете ответить до решения модератора.`;
    case 'dispute_withdrawn':
      return `${quoted(input.race)}: спор на ваш результат отозван.`;
    case 'dispute_responded':
      return `${quoted(input.race)}: райдер ответил. Решение примет модератор.`;
    case 'dispute_decided':
      return `${quoted(input.race)}: спор рассмотрен — ${OUTCOME[input.outcome]}.`;
    case 'ride_cancelled':
      return `${quoted(input.ride)} ${dayTime(input.startsAt)} отменён.`;
    case 'ride_rescheduled':
      return `${quoted(input.ride)}: новое время или место старта — ${dayTime(input.startsAt)}.`;
    case 'ride_joined':
      return `${quoted(input.ride)}: участников — ${input.goingCount}.`;
    case 'ride_report_resolved':
      return `Модератор рассмотрел вашу жалобу на райд ${quoted(input.ride)}. Спасибо.`;
    case 'route_published':
      return `${quoted(input.route)} теперь в каталоге маршрутов.`;
    case 'route_rejected':
      return `${quoted(input.route)} не опубликован. ${REJECTION[input.reason]}`;
    case 'event_reminder': {
      const place = input.place === null ? '' : `, ${input.place.replace(/\s+/g, ' ').trim()}`;
      return `${quoted(input.event)} — ${dayTime(input.startsAt)}${place}.\n${input.text}`;
    }
    case 'profile_name_reset':
      return 'Модератор сбросил имя после жалоб. Укажите другое имя в профиле.';
    case 'profile_avatar_reset':
      return input.blockedUntil
        ? `Модератор удалил фото после жалоб. Загрузка фото недоступна до ${dayTime(input.blockedUntil)}.`
        : 'Модератор удалил фото после жалоб. Загрузите другое фото.';
    case 'profile_club_reset':
      return 'Модератор сбросил клуб после жалоб. Укажите другой клуб в профиле.';
    case 'achievement_granted':
      return t(`achievements.object.${input.objectKind}` as MessageKey, {
        title: oneLine(input.objectTitle),
      });
  }
}

/** Заголовок и текст уведомления по таблице продукта. */
export function renderNotification(input: NoticeText): RenderedText {
  const title = input.kind === 'achievement_granted' ? achievementTitle(input) : TITLES[input.kind];
  return { title, body: bodyOf(input) };
}

/** Русская форма числа: `one` (1, 21, 101), `few` (2–4, 22–24), `many` (0, 5–20, 11–14, 25…). */
function ruPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Сводка отложенных push (N7): «У вас N новых уведомлений» с формами числа (RC-7). */
export function renderPushSummary(count: number): RenderedText {
  const noun = ruPlural(count, 'новое уведомление', 'новых уведомления', 'новых уведомлений');
  return { title: 'Покатим', body: `У вас ${count} ${noun}.` };
}
