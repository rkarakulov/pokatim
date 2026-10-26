import type { AttemptStatus, RaceResultStatus } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

type Tone = 'success' | 'neutral' | 'error' | 'ink';

export const ATTEMPT_TONE: Record<AttemptStatus, Tone> = {
  queued: 'ink',
  checking: 'ink',
  counted: 'success',
  rejected: 'error',
  failed: 'error',
  withdrawn: 'neutral',
  excluded: 'neutral',
};

export const RESULT_TONE: Record<RaceResultStatus, Tone> = {
  none: 'neutral',
  pending: 'ink',
  provisional: 'success',
  not_counted: 'error',
  dns: 'neutral',
  withdrawn: 'neutral',
  final: 'success',
  dq: 'error',
  revised: 'ink',
};

/** «Участник ·a1b2c3» — имён в панели нет (A12), короткий id заявки. */
export const riderLabel = (entryId: string) => t('admin.results.rider', { id: entryId.slice(-6) });

/** «1», «=2» (ничья), «—» (без места). */
export function placeLabel(place: number | null, tied: boolean): string {
  if (place === null) return '—';
  return tied ? t('admin.results.tiePlace', { place }) : String(place);
}
