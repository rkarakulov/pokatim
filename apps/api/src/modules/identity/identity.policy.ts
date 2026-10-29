/**
 * Сроки и лимиты онбординга — значения прототипа (решение Q4, task 2026-10-22-onboarding-01-signup) и решения
 * слайсов 2–3 (task 2026-10-24-onboarding-02-sign-in и 2026-10-25-onboarding-03-password-reset, §8.2).
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const IDENTITY_POLICY = {
  /** Ссылка подтверждения и токен регистрации (скользящий — продлевается при повторе). */
  verificationLinkTtlMs: DAY_MS,
  /** Повтор письма: пауза и не больше N за сутки. */
  resendLimit: { cooldownSec: 60, limit: 10, windowSec: DAY_MS / 1000 },
  /** Регистрации с одного IP [ASSUMPTION: CGNAT, поэтому не меньше]. */
  registerPerIpLimit: { limit: 20, windowSec: HOUR_MS / 1000 },
  accessTokenTtlMs: 15 * MINUTE_MS,
  /** Скользящий срок сессии: от выдачи и от каждой ротации refresh (Q5 слайса 2)… */
  refreshTokenTtlMs: 30 * DAY_MS,
  /** …но не дальше абсолютного предела от входа: потом — вход по паролю. */
  sessionAbsoluteTtlMs: 180 * DAY_MS,
  /**
   * Окно повтора ротации (R3 слайса 2): предыдущий refresh ещё действует после ротации — ответ мог потеряться
   * в мобильной сети. Позже — reuse detection: сессия отзывается.
   */
  refreshReuseGraceMs: MINUTE_MS,
  /** Ротация refresh с одного IP: перезагрузки вкладок и повторы — с запасом, перебор — нет (R6 F5b). */
  refreshPerIpLimit: { limit: 60, windowSec: MINUTE_MS / 1000 },
  /**
   * Попытки входа за 15 мин (Q1/Q2 слайса 2, R1б): пара e-mail+IP — обычная блокировка после 5 попыток;
   * e-mail со всех IP — потолок распределённого перебора (чужой IP не блокирует владельца сразу); IP — spraying и
   * нагрузка argon2 [ASSUMPTION: CGNAT — с запасом]. Считаются все попытки, не только неудачные (R2а).
   */
  signInLimits: {
    emailIp: { limit: 5, windowSec: (15 * MINUTE_MS) / 1000 },
    email: { limit: 20, windowSec: (15 * MINUTE_MS) / 1000 },
    ip: { limit: 50, windowSec: (15 * MINUTE_MS) / 1000 },
  },
  /** Ссылка сброса пароля (Q1 слайса 3): короткая — она даёт доступ к аккаунту. */
  passwordResetLinkTtlMs: HOUR_MS,
  /**
   * Запрос ссылки сброса (Q5 слайса 3): e-mail — пауза 60 с и не больше 5 писем за сутки; IP — 20 запросов в час
   * [ASSUMPTION: CGNAT]. Считаются и запросы на несуществующие адреса: 429 одинаков для любых адресов.
   */
  passwordResetLimits: {
    email: { cooldownSec: 60, limit: 5, windowSec: DAY_MS / 1000 },
    ip: { limit: 20, windowSec: HOUR_MS / 1000 },
  },
  /** Неподтверждённые аккаунты удаляются через 7 дней (V-10). */
  unverifiedRetentionMs: 7 * DAY_MS,
  cleanupBatchSize: 1_000,
  /** Срок захвата отправки письма: больше худшего SMTP (таймауты 10+10+15 с), меньше суммы ретраев BullMQ. */
  emailSendLeaseMs: MINUTE_MS,
} as const;

export const JWT_ISSUER = 'pokatim';
export const JWT_AUDIENCE = 'pokatim-app';

/**
 * Удаление аккаунта «зависло», если очистка не завершилась за сутки: штатно повторный проход — через 15 мин, регламент
 * resume — каждый час (`ACCOUNT_POLICY`). Один порог на карточку «Обзора» и экран сбоев панели (erasure-failures).
 */
export const ERASURE_STUCK_MS = DAY_MS;

/** Повтор очистки из панели не ставится заново раньше этого срока, если после него не было сбоя (идемпотентность). */
export const ERASURE_RETRY_COOLDOWN_MS = 15 * MINUTE_MS;
