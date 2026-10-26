import type { MyAttempt, MyAttemptTrack } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

/**
 * Свой трек на карте гонки (maps-02) — чистая логика показа: какая попытка на карте и текстовая альтернатива
 * подсветки (под картой и в подписи a11y). Метры схода — из `MyAttempt.segment` (итог сверки), разметка — `marks`
 * ответа трека; клиент сход не считает.
 */

/** Выбранная попытка (есть в списке), иначе лучшая, иначе новая (сервер отдаёт новые сверху). */
export function pickTrackAttempt(
  attempts: readonly MyAttempt[],
  selectedId: string | null,
): MyAttempt | null {
  return (
    attempts.find((attempt) => attempt.id === selectedId) ??
    attempts.find((attempt) => attempt.isBest) ??
    attempts[0] ??
    null
  );
}

const WITH_SEGMENT: readonly MyAttempt['status'][] = ['counted', 'rejected', 'excluded'];

/**
 * Строки под картой (RC-7): проверка идёт — «проверяется»; сегмент есть — метры схода или «весь в коридоре»;
 * отказ — основная причина и «Где сход — пунктиром», если участки есть; разметки нет — «недоступна».
 */
export function myTrackLines(
  attempt: MyAttempt,
  marks: MyAttemptTrack['marks'],
  offRuns: number,
): string[] {
  if (marks === 'pending' || attempt.status === 'queued' || attempt.status === 'checking') {
    return [t('races.detail.myTrack.pending')];
  }
  const lines: string[] = [];
  const { segment } = attempt;
  if (segment && WITH_SEGMENT.includes(attempt.status)) {
    lines.push(
      segment.offCorridorM > 0
        ? t('races.detail.myTrack.offSummary', {
            off: segment.offCorridorM,
            max: segment.maxExcursionM,
          })
        : t('races.detail.myTrack.allInside'),
    );
  }
  if (attempt.status === 'rejected') {
    lines.push(t(`races.attempt.reason.${attempt.reasons[0] ?? 'unknown'}`));
    if (marks === 'ready' && offRuns > 0) lines.push(t('races.detail.myTrack.whereOff'));
  }
  if (marks !== 'ready') lines.push(t('races.detail.myTrack.unavailable'));
  return lines;
}

/** Подпись a11y карты: подпись маршрута и строки трека. */
export const myTrackMapLabel = (mapLabel: string, lines: readonly string[]): string =>
  t('races.detail.myTrack.mapLabel', { map: mapLabel, track: lines.join('. ') });
