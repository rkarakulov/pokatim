import {
  PANEL_INVITATION_LIST_CAP,
  PANEL_INVITATION_TTL_DAYS,
  PANEL_MEMBER_LIST_CAP,
} from '@pokatim/contracts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Сроки и пределы панели (task admin-01, решения автора Q6). */
export const PANEL_POLICY = {
  /** Простой сессии: без запросов дольше — вход заново. */
  sessionIdleMs: 2 * HOUR_MS,
  /** Абсолютный срок сессии от входа, даже при активности. */
  sessionAbsoluteMs: 12 * HOUR_MS,
  /** Продление простоя пишется не чаще раза в N: гард не пишет в БД на каждом запросе. */
  touchIntervalMs: 5 * MINUTE_MS,
  /** Список «Сотрудники» — без пагинации до этого предела. */
  memberListCap: PANEL_MEMBER_LIST_CAP,
  /** 2FA (ADR-0024, D7): вызов второго шага входа — 5 минут, не больше 5 попыток кода. */
  challengeTtlMs: 5 * MINUTE_MS,
  challengeMaxAttempts: 5,
  /** D4: «запомнить устройство» — 30 дней, не больше 10 устройств на сотрудника. */
  trustedDeviceTtlMs: 30 * 24 * HOUR_MS,
  trustedDeviceMax: 10,
  /** D8: лимиты ввода кода (каждая попытка: вход, подключение, отключение, перевыпуск) — по очереди до отказа. */
  totpLimits: {
    ip: { limit: 50, windowSec: (15 * MINUTE_MS) / 1000 },
    user: { limit: 10, windowSec: (15 * MINUTE_MS) / 1000 },
  },
  /** Приглашения (ADR-0026): срок ссылки — 7 суток; документ убирается через 30 суток после закрытия/истечения. */
  invitationTtlMs: PANEL_INVITATION_TTL_DAYS * DAY_MS,
  invitationPurgeAfterMs: 30 * DAY_MS,
  invitationListCap: PANEL_INVITATION_LIST_CAP,
  /** RC-9: приглашений с одного сотрудника — 30 в час (письма на любые адреса). */
  invitationsUserLimit: { limit: 30, windowSec: HOUR_MS / 1000 },
  /** IP-лимит принятия приглашения (до пароля; у пароля — ещё общие `signin-*`). */
  invitationAcceptIpLimit: { limit: 20, windowSec: (15 * MINUTE_MS) / 1000 },
} as const;

/** Удалённый аккаунт в ответах панели вместо e-mail и имени. */
export const DELETED_MEMBER = 'Удалённый участник';
