import { defineErrorCodes, defineFieldErrorCodes } from '@rkarakulov/contracts-core';
import { z } from 'zod';

/** Версия публичного API: установленные приложения живут на старых версиях, ломать нельзя. */
export const API_VERSION = 'v1' as const;

export { PageQuery, RateLimitedDetails, Uuid } from '@rkarakulov/contracts-core';

/** Коды базы: их тексты и обработку даёт инфраструктура базы (фильтр ошибок api-kit, клиент). */
export { BASE_ERROR_CODES, type BaseErrorCode } from '@rkarakulov/contracts-core';

/**
 * Коды ошибок API: коды базы + коды проекта. Порядок — база первой, свои — только в конец списка
 * (установленные клиенты знают прежний состав). Тексты своих кодов — apps/api/src/error-messages.ts.
 */
export const { ErrorCode, ApiError } = defineErrorCodes([
  // регистрация pokatim
  'EMAIL_TAKEN',
  'EMAIL_UNAVAILABLE',
  'LINK_EXPIRED',
  // вход по паролю (слайс 2): неверный пароль, неизвестный и удалённый адрес — один код
  'INVALID_CREDENTIALS',
  // панель «Протокол» (admin-01): верный пароль без роли; выдача роли неподтверждённому, повторная выдача;
  // последний активный администратор; действие над собой
  'PANEL_ACCESS_DENIED',
  'PANEL_USER_UNVERIFIED',
  'PANEL_ALREADY_MEMBER',
  'PANEL_LAST_ADMIN',
  'PANEL_SELF_ACTION',
  // гонки (admin-02): действие недоступно в текущем статусе гонки (публикация не черновика, отмена черновика, …)
  'RACE_INVALID_STATE',
  // треки (tracks-devices): формат не FIT/GPX по содержимому; файл больше 16 МиБ; хранилище переполнено
  'TRACK_FORMAT_UNSUPPORTED',
  'TRACK_TOO_LARGE',
  'TRACK_STORAGE_FULL',
  // устройства (tracks-devices): провайдер недоступен (вне allowlist, выключен в агрегаторе, агрегатор выключен);
  // тикет чужой, истёк или использован; агрегатор ответил ошибкой
  'DEVICE_PROVIDER_UNAVAILABLE',
  'DEVICE_LINK_INVALID',
  'DEVICE_PROVIDER_ERROR',
  // маршруты (race-results-01): формат не GPX (routes-02: и не KML) по содержимому; файл больше 5 МиБ
  'ROUTE_FORMAT_UNSUPPORTED',
  'ROUTE_TOO_LARGE',
  // кофе-райды (app-05): мест нет; райд начался или отменён; квота будущих райдов или отметок
  'RIDE_FULL',
  'RIDE_INVALID_STATE',
  'RIDE_QUOTA_EXCEEDED',
  // участие и попытки (race-results-03): заявка закрыта (details.reason); участие уже отменено; нужна активная
  // заявка; отмена после окна; срок загрузки (details.reason); предел попыток; заезд нельзя добавить в гонку
  'RACE_ENTRY_CLOSED',
  'RACE_ENTRY_WITHDRAWN',
  'RACE_ENTRY_REQUIRED',
  'RACE_WITHDRAW_CLOSED',
  'ATTEMPT_UPLOAD_CLOSED',
  'ATTEMPT_LIMIT',
  'ATTEMPT_SOURCE_INVALID',
  // протокол гонки (race-results-05): действие панели недоступно (details.reason); публикация заблокирована
  // чек-листом или состоянием гонки (details: blockedBy, checklist)
  'RESULTS_ACTION_BLOCKED',
  'RESULTS_PUBLISH_BLOCKED',
  // споры (race-results-06): действие со спором недоступно (details.reason, availableAt); спора нет или он не виден
  'DISPUTE_ACTION_BLOCKED',
  'DISPUTE_NOT_FOUND',
  // routes-01: действие с маршрутом недоступно в его статусе (публикация в каталог не готового)
  'ROUTE_INVALID_STATE',
  // routes-02: предел числа своих маршрутов райдера
  'ROUTE_QUOTA_EXCEEDED',
  // удаление аккаунта: неверный текущий пароль (403 — не 401: клиент не путает с истёкшей сессией); член команды
  // панели аккаунт не удаляет (409, A11)
  'PASSWORD_INCORRECT',
  'ACCOUNT_PANEL_MEMBER',
  // race-results-07: Verified без анкеты (409); понижение до START, смена группы или уровня после окна (409); группа
  // не своя и не младшая своего пола (422); пол и год анкеты зафиксированы первой Verified-заявкой (409)
  'VERIFIED_PROFILE_REQUIRED',
  'RACE_TIER_LOCKED',
  'RESULT_GROUP_NOT_ALLOWED',
  'VERIFIED_DEMOGRAPHICS_LOCKED',
  // routes-06: лимит подач маршрута в каталог (details: limit, max)
  'ROUTE_PUBLICATION_LIMIT',
  // story-cards: карточки нет (нет заявки, времени, снята, DQ) — 409
  'STORY_CARD_UNAVAILABLE',
  // route-rides-01: заезд ещё обрабатывается (409); файл заезда с отказом разбора (409); квота заездов на маршрут (409)
  'ROUTE_RIDE_NOT_READY',
  'ROUTE_RIDE_UPLOAD_FAILED',
  'ROUTE_RIDE_QUOTA_EXCEEDED',
  // rider-profile: фото не JPEG/PNG/WebP (415); больше 10 МиБ (413); не декодируется, больше предела пикселей, мелкая обрезка (422)
  'AVATAR_FORMAT_UNSUPPORTED',
  'AVATAR_TOO_LARGE',
  'AVATAR_INVALID',
  // profile-moderation: жалоба на свой профиль (409, details.reason)
  'PROFILE_INVALID_STATE',
  // event-tickets: мест нет (409); регистрация на старт закрыта (409, details.reason); настройки билетов нельзя
  // применить в состоянии события (409, details.reason)
  'EVENT_FULL',
  'EVENT_REGISTRATION_CLOSED',
  'TICKETING_INVALID_STATE',
  // event-tickets PR C: материал — не PDF по сигнатуре (415); PDF больше 10 МиБ (413)
  'MATERIAL_FILE_UNSUPPORTED',
  'MATERIAL_FILE_TOO_LARGE',
  // panel-2fa (ADR-0024): неверный, повторённый или погашенный код (400, одно сообщение); вызов входа неизвестен,
  // истёк, исчерпан или штамп сменился (401); 2FA уже подключена / не подключена; отключить нельзя — обязательна
  // (409); нет ключа шифрования на сервере (503)
  'TOTP_INVALID_CODE',
  'TOTP_CHALLENGE_EXPIRED',
  'TOTP_ALREADY_ENABLED',
  'TOTP_NOT_ENABLED',
  'TOTP_REQUIRED',
  'TOTP_UNAVAILABLE',
  // panel-invitations (ADR-0026): приглашение неизвестно, истекло, отозвано или принято (410, одна ошибка); e-mail
  // аккаунта не совпадает с адресом приглашения (409); нет адреса панели для ссылки на сервере (503)
  'PANEL_INVITATION_INVALID',
  'PANEL_INVITATION_EMAIL_MISMATCH',
  'PANEL_INVITATIONS_UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
export type ApiError = z.infer<typeof ApiError>;

/**
 * Коды полей правил сезонов, гонок и календаря (admin-02): сервер возвращает их под полем формы панели. Формы
 * приложения их не получают.
 */
export const SCHEDULE_FIELD_ERROR_CODES = [
  'SEASON_OVERLAP',
  'SEASON_IN_PAST',
  'SEASON_FINISHED',
  'SEASON_EXCLUDES_RACES',
  'DATE_ORDER',
  'WINDOW_IN_PAST',
  'OUTSIDE_SEASON',
  'PROTOCOL_TOO_EARLY',
  'PROTOCOL_ONLY_LATER',
  'FIELD_LOCKED',
  // коридор гонки (race-results-01): маршрут не готов, не найден или недоступен
  'ROUTE_NOT_READY',
] as const;
export type ScheduleFieldErrorCode = (typeof SCHEDULE_FIELD_ERROR_CODES)[number];

/**
 * Коды полей формы кофе-райда (app-05): старт раньше чем через 30 мин / дальше 60 дней; темп «от» больше «до»; лимит
 * ниже идущих. Только в конец общего списка.
 */
export const RIDE_FIELD_ERROR_CODES = [
  'RIDE_START_IN_PAST',
  'RIDE_START_TOO_FAR',
  'RIDE_PACE_ORDER',
  'RIDE_LIMIT_BELOW_GOING',
] as const;
export type RideFieldErrorCode = (typeof RIDE_FIELD_ERROR_CODES)[number];

/**
 * Коды полей коридора гонки (race-results-03): ворота старта и финиша линейного маршрута пересекаются при этом
 * допуске. После кодов кофе-райдов — только в конец общего списка.
 */
export const CORRIDOR_FIELD_ERROR_CODES = ['CORRIDOR_GATES_OVERLAP'] as const;
export type CorridorFieldErrorCode = (typeof CORRIDOR_FIELD_ERROR_CODES)[number];

/**
 * Код поля «Маршрут» райда (05c): маршрут нельзя прикрепить — нет, чужой непубличный или не готов (один код: без
 * оракула существования).
 */
export const RIDE_ROUTE_FIELD_ERROR_CODES = ['RIDE_ROUTE_UNAVAILABLE'] as const;
export type RideRouteFieldErrorCode = (typeof RIDE_ROUTE_FIELD_ERROR_CODES)[number];

/**
 * Коды ошибок полей: коды базы (`REQUIRED`, `INVALID`, …) + коды проекта. Сообщение zod-схемы = код,
 * текст для человека выбирает клиент (i18n). `fieldError` — с кодами проекта, не базовый.
 */
export const { FieldErrorCode, ValidationErrorDetails, fieldError } = defineFieldErrorCodes([
  'AGE_BELOW_18',
  'CONSENT_REQUIRED',
  ...SCHEDULE_FIELD_ERROR_CODES,
  ...RIDE_FIELD_ERROR_CODES,
  ...CORRIDOR_FIELD_ERROR_CODES,
  ...RIDE_ROUTE_FIELD_ERROR_CODES,
]);
export type FieldErrorCode = z.infer<typeof FieldErrorCode>;
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetails>;

/**
 * Открытый enum **ответов приложения** (R6): установленные сборки живут долго, а справочники (класс, покрытие, фаза,
 * причина) только дополняются в конец — незнакомое значение разбирается как `'unknown'`, а не роняет весь ответ.
 * UI приложения обязан показать нейтральный вариант. Запросы и панель — строгий `z.enum`.
 */
export function tolerantEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.union([z.enum(values), z.string().transform(() => 'unknown' as const)]);
}

/**
 * Массив фильтра из query: `?k=a&k=b` приходит массивом, `?k=a` — строкой; одна строка → массив из неё. Длина
 * ограничена (запросы к БД — по индексам, без «тысячи значений»).
 */
export function queryArray<T extends z.ZodType>(item: T, max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? [value] : value),
    z.array(item).max(max, { error: 'INVALID' }),
  );
}

/** Версия записи для оптимистичной правки (R3): изменение несёт ожидаемую `version`, устаревшая — `409 CONFLICT`. */
export const Version = z
  .number({ error: fieldError('INVALID') })
  .int()
  .nonnegative();
export type Version = z.infer<typeof Version>;

/** Однострочный текст без управляющих символов (названия, город). */
export const SINGLE_LINE = /^[^\p{Cc}]+$/u;
/** Многострочный текст: из управляющих — только перевод строки. */
export const MULTI_LINE = /^[^\p{Cc}]*(?:\n[^\p{Cc}]*)*$/u;

/** Необязательный текст: пустой после обрезки — `null`. */
export const optionalText = (max: number, pattern: RegExp) =>
  z
    .string({ error: fieldError('INVALID') })
    .trim()
    .max(max, { error: 'TOO_LONG' })
    .regex(new RegExp(`${pattern.source}|^$`, pattern.flags), { error: 'INVALID' })
    .transform((value) => (value === '' ? null : value))
    .nullable();
