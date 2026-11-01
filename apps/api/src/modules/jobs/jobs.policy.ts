import { FAILED_JOB_ERROR_MAX, OUTBOX_STUCK_MINUTES } from '@pokatim/contracts';

/** Правила экрана «Упавшие задачи» (admin-failed-jobs). */
export const FAILED_JOBS_POLICY = {
  /** мутации панели на сотрудника (`failed-jobs-panel:<uid>`) */
  actionLimit: { limit: 120, windowSec: 3600 },
  /** событие outbox без публикации дольше — застряло (публикатор пробует сам, панель только показывает) */
  outboxStuckMs: OUTBOX_STUCK_MINUTES * 60_000,
  /** предел подсчёта застрявших событий: точнее экрану не нужно */
  outboxCountMax: 10_000,
} as const;

const EMAIL = /[^\s@<>"'()[\]]+@[^\s@<>"'()[\]]+\.[^\s@<>"'()[\]]+/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Текст ошибки для панели: первая непустая строка `failedReason` (без стека), e-mail заменены на «[e-mail]» (ошибки SMTP
 * несут адрес получателя), не длиннее `FAILED_JOB_ERROR_MAX`. Пусто — `null`.
 */
export function panelJobError(reason: string | undefined | null): string | null {
  const line = (reason ?? '')
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return null;
  const masked = line.replace(EMAIL, '[e-mail]');
  return masked.length > FAILED_JOB_ERROR_MAX
    ? `${masked.slice(0, FAILED_JOB_ERROR_MAX - 1)}…`
    : masked;
}

/** id события outbox из данных задачи публикатора (`{ outboxEventId }`); иначе `null`. Прочие данные не читаются. */
export function outboxEventIdOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as { outboxEventId?: unknown }).outboxEventId;
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
}

/** Подпись объекта журнала: очередь и id задачи (снимок на момент действия). */
export const jobSubjectLabel = (queue: string, jobId: string) => `${queue} · ${jobId}`;
