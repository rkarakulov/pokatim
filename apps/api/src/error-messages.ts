import type { BaseErrorCode, ErrorCode } from '@pokatim/contracts';
import { DomainError } from '@rkarakulov/api-kit/core';

/**
 * Тексты кодов ошибок проекта для фильтра ошибок базы (`API_ERROR_MESSAGES` в AppModule).
 * Коды базы фильтр озвучивает сам; новый код в контракте без записи здесь — ошибка typecheck.
 */
export const PROJECT_ERROR_MESSAGES = {
  EMAIL_TAKEN: 'E-mail уже зарегистрирован',
  EMAIL_UNAVAILABLE: 'E-mail недоступен для регистрации',
  LINK_EXPIRED: 'Ссылка устарела',
  INVALID_CREDENTIALS: 'Неверный e-mail или пароль',
  PANEL_ACCESS_DENIED: 'Аккаунт не входит в команду платформы',
  PANEL_USER_UNVERIFIED: 'E-mail пользователя не подтверждён',
  PANEL_ALREADY_MEMBER: 'Пользователь уже в команде платформы',
  PANEL_LAST_ADMIN: 'Нельзя оставить панель без администратора',
  PANEL_SELF_ACTION: 'Нельзя менять свою роль',
  RACE_INVALID_STATE: 'Действие недоступно в текущем статусе гонки',
  TRACK_FORMAT_UNSUPPORTED: 'Поддерживаются файлы FIT и GPX',
  TRACK_TOO_LARGE: 'Файл больше 16 МБ',
  TRACK_STORAGE_FULL: 'Хранилище файлов заполнено, попробуйте позже',
  DEVICE_PROVIDER_UNAVAILABLE: 'Подключение временно недоступно',
  DEVICE_LINK_INVALID: 'Ссылка подключения недействительна',
  DEVICE_PROVIDER_ERROR: 'Сервис подключения устройств не ответил',
  ROUTE_FORMAT_UNSUPPORTED: 'Выберите файл GPX',
  ROUTE_TOO_LARGE: 'Файл больше 5 МБ',
  RIDE_FULL: 'Мест нет',
  RIDE_INVALID_STATE: 'Райд уже начался или отменён',
  RIDE_QUOTA_EXCEEDED: 'Достигнут предел будущих райдов',
  RACE_ENTRY_CLOSED: 'Приём заявок на гонку закрыт',
  RACE_ENTRY_WITHDRAWN: 'Участие в этой гонке уже отменено',
  RACE_ENTRY_REQUIRED: 'Сначала заявитесь на гонку',
  RACE_WITHDRAW_CLOSED: 'Отменить участие можно, пока окно открыто',
  ATTEMPT_UPLOAD_CLOSED: 'Срок загрузки заездов истёк',
  ATTEMPT_LIMIT: 'Достигнут предел заездов для гонки',
  ATTEMPT_SOURCE_INVALID: 'Этот заезд нельзя добавить в гонку',
  RESULTS_ACTION_BLOCKED: 'Действие с результатами гонки сейчас недоступно',
  RESULTS_PUBLISH_BLOCKED: 'Протокол пока нельзя опубликовать',
  DISPUTE_ACTION_BLOCKED: 'Действие со спором сейчас недоступно',
  DISPUTE_NOT_FOUND: 'Спор не найден',
  ROUTE_INVALID_STATE: 'Маршрут ещё не готов',
} as const satisfies Record<Exclude<ErrorCode, BaseErrorCode>, string>;

/** Ожидаемый отказ бизнес-логики с кодом из контракта: опечатка в коде — ошибка компиляции. */
export const domainError = (code: ErrorCode, status: number, details?: unknown) =>
  new DomainError<ErrorCode>(code, status, details);
