import { PANEL_MEMBER_LIST_CAP } from '@pokatim/contracts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

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
  /** 2FA (ADR-0024, D7): вызов второго шага входа — 5 минут, не больше 5 неверных кодов. */
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
} as const;

/** Удалённый аккаунт в ответах панели вместо e-mail и имени. */
export const DELETED_MEMBER = 'Удалённый участник';
