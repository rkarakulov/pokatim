import type {
  AttemptSensors,
  AttemptStatus,
  PanelAttemptFlag,
  RaceResultStatus,
} from '@pokatim/contracts';
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
  // race-results-07: время без места (START, без пульса) — блок «Финишёры»
  finisher: 'neutral',
};

/**
 * «Анна К. ·a1b2c3» — публичное имя (только с согласием райдера, profile-02) и короткий id заявки; имени нет —
 * «Участник ·a1b2c3».
 */
export function riderLabel(entryId: string, riderName: string | null = null): string {
  const id = entryId.slice(-6);
  return riderName === null
    ? t('admin.results.rider', { id })
    : t('admin.results.riderNamed', { name: riderName, id });
}

/**
 * Участник рейтинга сезона (race-results-08b): короткий id — по `userId` (заявки нет), как `riderLabel`; без `userId`
 * (организатор, RC-8) — имя или «Участник» без id.
 */
export function seasonRiderLabel(userId: string | null, riderName: string | null): string {
  if (userId !== null) return riderLabel(userId, riderName);
  return riderName ?? t('admin.standings.rider');
}

/** «1», «=2» (ничья), «—» (без места). */
export function placeLabel(place: number | null, tied: boolean): string {
  if (place === null) return '—';
  return tied ? t('admin.results.tiePlace', { place }) : String(place);
}

const RATIO = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const PERCENT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/**
 * Метрика флага «Требует внимания» (race-results-07): `SPEED_CLUSTER_HIGH` — отношение времени к медиане группы
 * («Время ×0,782 медианы группы»), флаги датчиков — целые проценты («18 % сегмента без пульса»).
 */
export function flagMetricText(flag: PanelAttemptFlag): string {
  const value =
    flag.code === 'SPEED_CLUSTER_HIGH' ? RATIO.format(flag.metric) : PERCENT.format(flag.metric);
  return t(`admin.results.flagMetric.${flag.code}`, { value });
}

/**
 * Датчики сегмента попытки: «Пульс, мощность», «Пульс», «Нет»; `null` (до вердикта, сбой) — «—».
 * Импорт Garmin/Wahoo (`source: 'declared'`, DV-11) — признак тренировки из потока: «Пульс (заявлено импортом)».
 */
export function sensorsText(sensors: AttemptSensors | null): string {
  if (sensors === null) return '—';
  const text = sensorsPresence(sensors);
  return sensors.source === 'declared'
    ? t('admin.results.sensors.declared', { sensors: text })
    : text;
}

function sensorsPresence(sensors: AttemptSensors): string {
  if (sensors.hr && sensors.power) return t('admin.results.sensors.both');
  if (sensors.hr) return t('admin.results.sensors.hr');
  return sensors.power ? t('admin.results.sensors.power') : t('admin.results.sensors.none');
}
