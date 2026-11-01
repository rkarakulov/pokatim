/**
 * Порт `results` для модуля `notifications` (ADR-0017; через `modules/results/index.ts`): получатели и поля текста
 * уведомлений о результатах. `notifications` коллекций `results` не читает; только id и время — без результатов.
 */
export const RESULTS_NOTICES = Symbol('RESULTS_NOTICES');

/** Попытка для уведомления о вердикте: райдер, гонка и начало заезда (дата в тексте). */
export interface AttemptNotice {
  userId: string;
  raceId: string;
  activityStartedAt: Date;
}

export interface ResultsNotices {
  attempt(attemptId: string): Promise<AttemptNotice | null>;
  /** `userId` активных заявок гонки, в том числе без результата («Протокол опубликован», «Гонка отменена»). */
  protocolAudience(raceId: string): Promise<string[]>;
  /** `userId` строк ревизии протокола (перепроверка применена — участники с результатом). */
  revisionAudience(raceId: string, revision: number): Promise<string[]>;
  /** Владелец заявки (дисквалификация и её отмена). */
  entryUser(entryId: string): Promise<string | null>;
}
