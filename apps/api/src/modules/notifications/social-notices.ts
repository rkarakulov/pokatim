import {
  minskToday,
  type NotificationGroup,
  type NotificationKind,
  type NotificationTarget,
} from '@pokatim/contracts';
import { z } from 'zod';

import type { PublicRiderCard } from '../profile';
import { eventTimeOf } from './event-time';

/**
 * Группа «Свои» (K10, ADR-0027 п. 6, social-p1): чистые функции видов — окно схлопывания, черновик для intake (P7),
 * рендер с именами действующих лиц при чтении списка и отправке push. Имена в документе не хранятся (N12 для
 * хранения): `actors` — id, `params` — название объекта; имя — `RIDER_NAMES.publicRiders` в момент чтения.
 */
export type SocialNoticeKind = Extract<NotificationKind, `social_${string}`>;

/** Объект события: райд, гонка или маршрут (респект — гонке или маршруту). */
export type SocialObjectType = 'ride' | 'race' | 'route';

interface SocialKindRule {
  title: string;
  /** `object` — цель по объекту (`ride` / `race` / `my-route`), `rider` — профиль действующего лица (при чтении) */
  target: 'object' | 'rider';
  /** `object` — на объект, `day` — в сутки по Минску, `object-day` — на объект в сутки */
  window: 'object' | 'day' | 'object-day';
  /** копит действующих лиц (`actors`); без них — обычный снимок (RC-10) */
  actors: boolean;
  /** тело — «{имена} · «{объект}»» */
  objectInBody: boolean;
  /** часть ключа окна: `social:<slug>:…` */
  slug: string;
}

export const SOCIAL_NOTICE_KINDS = {
  social_riders_going: {
    title: 'Свои идут',
    target: 'object',
    window: 'object',
    actors: true,
    objectInBody: true,
    slug: 'going',
  },
  social_thanks: {
    title: 'Спасибо за компанию',
    target: 'object',
    window: 'object',
    actors: true,
    objectInBody: true,
    slug: 'thanks',
  },
  social_added: {
    title: 'Вас добавили в свои',
    target: 'rider',
    window: 'day',
    actors: true,
    objectInBody: false,
    slug: 'added',
  },
  social_respect: {
    title: 'Респект',
    target: 'object',
    window: 'object-day',
    actors: true,
    objectInBody: true,
    slug: 'respect',
  },
  social_invite_registered: {
    title: 'По вашей ссылке зарегистрировались',
    target: 'rider',
    window: 'day',
    actors: true,
    objectInBody: false,
    slug: 'invite',
  },
  social_ride_ask: {
    title: 'Как прошёл райд?',
    target: 'object',
    window: 'object',
    actors: false,
    objectInBody: true,
    slug: 'ask',
  },
} as const satisfies Record<SocialNoticeKind, SocialKindRule>;

/**
 * Потолок действующих лиц в одном уведомлении (RC-2, = `RIDE_MAX_PARTICIPANTS`): полный документ больше не меняется,
 * `$in` имён страницы ограничен.
 */
export const SOCIAL_ACTORS_MAX = 100;

const OBJECT_TITLE_MAX = 200;

/** Данные текста без имён (RC-12): только название объекта, снимок; наружу не уходит. */
export const SocialNoticeParams = z.object({ object: z.string().max(OBJECT_TITLE_MAX) }).partial();
export type SocialNoticeParams = z.infer<typeof SocialNoticeParams>;

/** Текст «Своих» для `renderNotification` (запасной, без имён) и `params`. */
export interface SocialNoticeText {
  kind: SocialNoticeKind;
  object?: string;
}

const ANONYMOUS = 'Райдер';

/** Одна строка: пробелы и переводы строк схлопываются. */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Название в кавычках «…»: снимок — одна строка. */
export const quoted = (name: string) => `«${oneLine(name)}»`;

export const isSocialKind = (kind: NotificationKind): kind is SocialNoticeKind =>
  Object.hasOwn(SOCIAL_NOTICE_KINDS, kind);

/**
 * Ключ окна схлопывания (RC-7): день — по Минску момента события (`eventAt` — время uuidv7 события outbox, не `CLOCK`
 * приёма: ретрай после полуночи не открывает новое окно). Префикс `social:` не пересекается с другими группами.
 */
export function socialCollapseKey(
  kind: SocialNoticeKind,
  object: { type: SocialObjectType; id: string } | null,
  eventAt: Date,
): string {
  const rule: SocialKindRule = SOCIAL_NOTICE_KINDS[kind];
  const prefix = `social:${rule.slug}`;
  if (rule.window === 'day') return `${prefix}:${minskToday(eventAt)}`;
  if (!object) throw new Error(`social notice ${kind} needs an object`);
  if (rule.window === 'object') return `${prefix}:${object.id}`;
  return `${prefix}:${object.type}:${object.id}:${minskToday(eventAt)}`;
}

const objectTarget = (object: { type: SocialObjectType; id: string }): NotificationTarget => {
  switch (object.type) {
    case 'ride':
      return { type: 'ride', rideId: object.id };
    case 'race':
      return { type: 'race', raceId: object.id };
    case 'route':
      return { type: 'my-route', routeId: object.id };
  }
};

/**
 * Черновик «Своих» — структурно `NoticeDraft` (`notification-intake.ts`; импорт оттуда дал бы цикл модулей): P7 кладёт
 * его в результат `NotificationIntake.drafts`.
 */
export interface SocialNoticeDraft {
  text: SocialNoticeText;
  target: NotificationTarget | null;
  collapse: { key: string; seq?: number };
  actor?: string;
  recipients: string[];
}

/**
 * Черновик социального уведомления (точка входа P7, RC-9): ключ окна, цель, запасной текст. Виды с действующими
 * лицами — одно лицо на черновик (`actor`), накопление делает `writeNotices`; «Как прошёл райд?» — снимок без лиц с
 * заменой `seq: 1` (повтор окна без изменений, RC-10). Цель `rider` в документ не пишется (`null`, RC-4).
 */
export function socialNoticeDraft(input: {
  kind: SocialNoticeKind;
  eventId: string;
  actor: string | null;
  recipients: string[];
  object: { type: SocialObjectType; id: string; title: string } | null;
}): SocialNoticeDraft {
  const { kind, eventId, actor, recipients, object } = input;
  const rule: SocialKindRule = SOCIAL_NOTICE_KINDS[kind];
  const eventAt = eventTimeOf(eventId);
  if (!eventAt) throw new Error(`social notice ${kind}: event id is not uuidv7`);
  if (rule.actors && actor === null) throw new Error(`social notice ${kind} needs an actor`);
  const key = socialCollapseKey(kind, object, eventAt);
  const text: SocialNoticeText = {
    kind,
    ...(object ? { object: oneLine(object.title).slice(0, OBJECT_TITLE_MAX) } : {}),
  };
  return {
    text,
    target: rule.target === 'object' && object ? objectTarget(object) : null,
    collapse: rule.actors ? { key } : { key, seq: 1 },
    ...(rule.actors && actor !== null ? { actor } : {}),
    recipients,
  };
}

/**
 * `params` документа из текста черновика (`SocialNoticeText`): только название объекта — одна строка, ≤ 200 символов
 * (тот же потолок, что у `socialNoticeDraft` и `SocialNoticeParams`: прямой путь и пачка ведут себя одинаково).
 */
export function socialParamsOf(text: object): SocialNoticeParams {
  return 'object' in text && typeof text.object === 'string'
    ? { object: oneLine(text.object).slice(0, OBJECT_TITLE_MAX) }
    : {};
}

const bodyOf = (rule: SocialKindRule, names: string, object: string | undefined) => {
  if (!rule.actors) return `${quoted(object ?? '')}: отметьте, что были.`;
  return rule.objectInBody && object !== undefined ? `${names} · ${quoted(object)}` : names;
};

/** Запасной текст документа (RC-3): таблица v1 с «Райдер» вместо имён, без «и ещё N». */
export function socialFallbackText(text: SocialNoticeText): { title: string; body: string } {
  const rule: SocialKindRule = SOCIAL_NOTICE_KINDS[text.kind];
  return { title: rule.title, body: bodyOf(rule, ANONYMOUS, text.object) };
}

export interface SocialRenderable {
  kind: NotificationKind;
  title: string;
  body: string;
  target: NotificationTarget | null;
  actors?: readonly string[];
  params?: unknown;
}

/**
 * Текст и цель с текущими публичными именами (K10, K13): лицо имени — последнее в `actors` с карточкой (имя и согласие —
 * фильтр порта), нет — «Райдер»; несколько — «{имя} и ещё N» (N — остальные, включая непубличных). Цель `rider`-видов —
 * `publicId` того же лица (нет — `null`), прочих — сохранённая. Вид без правила, без лиц, битые `params` — сохранённые.
 */
export function renderSocialNotice(
  doc: SocialRenderable,
  cards: ReadonlyMap<string, PublicRiderCard>,
): { title: string; body: string; target: NotificationTarget | null } {
  const fallback = { title: doc.title, body: doc.body, target: doc.target };
  if (!isSocialKind(doc.kind)) return fallback;
  const rule: SocialKindRule = SOCIAL_NOTICE_KINDS[doc.kind];
  const actors = doc.actors ?? [];
  if (!rule.actors || actors.length === 0) return fallback;
  const params = SocialNoticeParams.safeParse(doc.params ?? {});
  if (!params.success) return fallback;
  const shown = actors.findLast((id) => cards.has(id));
  const card = shown === undefined ? undefined : cards.get(shown);
  const name = card ? oneLine(card.name) : ANONYMOUS;
  const others = actors.length - 1;
  const names = others > 0 ? `${name} и ещё ${others}` : name;
  const target =
    rule.target === 'rider'
      ? card?.publicId
        ? ({ type: 'rider', publicId: card.publicId } as const)
        : null
      : doc.target;
  return { title: rule.title, body: bodyOf(rule, names, params.data.object), target };
}

/** Действующие лица страницы (группа `social`) без повторов — один запрос `publicRiders` на страницу. */
export function socialActorIds(
  docs: readonly { group: NotificationGroup; actors?: readonly string[] }[],
): string[] {
  return [...new Set(docs.flatMap((doc) => (doc.group === 'social' ? (doc.actors ?? []) : [])))];
}
