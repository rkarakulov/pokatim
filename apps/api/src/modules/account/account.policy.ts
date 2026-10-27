const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Лимиты и сроки удаления аккаунта (task 2026-10-27-account-deletion, ADR-0015). */
export const ACCOUNT_POLICY = {
  /** Попытки удаления на пользователя [ASSUMPTION] — поверх общих счётчиков входа (A2). */
  deleteLimit: { limit: 5, windowSec: HOUR_MS / 1000 },
  /** Повторный проход очистки после первого (поздние записи, R5/F9). */
  sweepDelayMs: 15 * MINUTE_MS,
  /** Регламент resume ставит повторный проход удалённым раньше этого срока без `erasureSweptAt`. */
  resumeAfterMs: HOUR_MS,
  resumeBatch: 50,
  /** Письмо «Аккаунт удалён» не ушло за срок — стирание e-mail без письма (F8). */
  abandonEmailAfterMs: DAY_MS,
  /**
   * Захват отправки письма: больше худшего SMTP. Сбой SMTP снимает захват сразу (ретрай задачи шлёт снова); захват
   * остаётся, только если worker упал во время отправки, — тогда он переживает ретраи первого прохода (≈ 75 с), и
   * письмо отправит повторный проход (sweep через 15 мин) или регламент resume.
   */
  emailClaimMs: 5 * MINUTE_MS,
} as const;
