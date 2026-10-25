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
  memberListCap: 500,
} as const;

/** Удалённый аккаунт в ответах панели вместо e-mail и имени. */
export const DELETED_MEMBER = 'Удалённый участник';
