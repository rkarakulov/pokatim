import type {
  MyAttempt,
  MyRaceEntry,
  PendingUpload,
  RaceDetail,
  RaceEntryBlockReason,
  RaceResultRow,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import type { PillTone } from '@rkarakulov/ui';

import { actionErrorMessage, apiErrorCode } from '@/features/auth/error-messages';
import { isUploadInProgress, uploadStatus } from '@/features/devices/format';

import { formatElapsed } from './format';

/**
 * Участие и результат гонки (race-results-04) — чистая логика показа. Статусы, место, время и права (`actions`) —
 * только с сервера (`AGENTS.md` §4.1): здесь выбираются тексты и тоны, локальных правил «можно ли» нет.
 * `'unknown'` (`tolerantEnum`, сервер новее) — нейтрально.
 */

type Result = MyRaceEntry['result'];
type Actions = MyRaceEntry['actions'];
type BlockReason = RaceEntryBlockReason | 'unknown';

/** Причины недоступности заявки — подмножество общего `actions.reasons` (F1). */
export const ENTER_REASONS: readonly RaceEntryBlockReason[] = [
  'cancelled',
  'no_corridor',
  'entries_closed',
  'withdrawn',
];
/** Причины недоступности новой попытки (F1): `window_closed` относится к отмене участия. */
export const ATTEMPT_REASONS: readonly RaceEntryBlockReason[] = [
  'cancelled',
  'window_not_open',
  'upload_closed',
  'attempt_limit',
];

/** Своя причина важнее незнакомой (`unknown` может быть причиной другого действия); своей нет — `unknown`, если есть. */
function firstReason(actions: Actions, own: readonly RaceEntryBlockReason[]): BlockReason | null {
  const known = actions.reasons.find((reason): reason is RaceEntryBlockReason =>
    own.includes(reason as RaceEntryBlockReason),
  );
  if (known) return known;
  return actions.reasons.includes('unknown') ? 'unknown' : null;
}

/** Первая причина недоступности «Участвовать» из ответа сервера; своих причин нет — `null`. */
export const enterBlockReason = (actions: Actions) => firstReason(actions, ENTER_REASONS);

/** Первая причина недоступности новой попытки: `['window_closed','upload_closed']` → `upload_closed` (F1). */
export const addAttemptBlockReason = (actions: Actions) => firstReason(actions, ATTEMPT_REASONS);

export const blockReasonText = (reason: BlockReason): string => t(`races.block.${reason}`);

const hasCorridor = (race: RaceDetail) => (race.corridor ?? null) !== null;

/** Гостю — «Участвовать» (вход с возвратом): коридор есть и фаза сервера `upcoming | open`. Не права — показ. */
export const guestCanSeeEnter = (race: RaceDetail) =>
  hasCorridor(race) && (race.phase === 'upcoming' || race.phase === 'open');

/** Таблица результатов: коридор есть и фаза сервера `open | closed | final` (протокол — race-results-05). */
export const showsResultsTable = (race: RaceDetail) =>
  hasCorridor(race) && (race.phase === 'open' || race.phase === 'closed' || race.phase === 'final');

const RESULT_TONES: Record<Exclude<Result['status'], 'withdrawn'>, PillTone> = {
  none: 'neutral',
  pending: 'warning',
  provisional: 'neutral',
  not_counted: 'error',
  dns: 'neutral',
  // race-results-05: протокол опубликован; подробный показ — follow-up приложения
  final: 'success',
  dq: 'error',
  revised: 'neutral',
  unknown: 'neutral',
};

/** Плашка статуса результата (§7.2); `withdrawn` — без плашки (блок отменённого участия). */
export function resultPill(status: Result['status']): { label: string; tone: PillTone } | null {
  if (status === 'withdrawn') return null;
  return { label: t(`races.result.status.${status}`), tone: RESULT_TONES[status] };
}

/** Статусы с временем сегмента: предварительный и протокол (race-results-05); `pending` — сегмента ещё нет (D-37). */
const TIMED_STATUSES: readonly Result['status'][] = [
  'provisional',
  'final',
  'revised',
  'dq',
  'unknown',
];

/** «Ваше время»: только статусы с сегментом и временем. */
export function resultElapsed(result: Result): string | null {
  if (result.elapsedSec === null) return null;
  return TIMED_STATUSES.includes(result.status) ? formatElapsed(result.elapsedSec) : null;
}

/** Баннер результата: `pending` — «Место появится после проверки.»; `provisional` — место / ничья / примечание. */
export function resultBanner(
  result: Result,
  protocolDate: string,
): { tone: 'info' | 'warning'; message: string } | null {
  if (result.status === 'pending') {
    return { tone: 'warning', message: t('races.result.placeLater') };
  }
  if (result.status !== 'provisional') return null;
  if (result.place === null) {
    return { tone: 'info', message: t('races.result.provisionalNote', { date: protocolDate }) };
  }
  return {
    tone: 'info',
    message: t(result.tied ? 'races.result.placeTied' : 'races.result.place', {
      place: result.place,
      date: protocolDate,
    }),
  };
}

const ATTEMPT_TONES: Record<MyAttempt['status'], PillTone> = {
  queued: 'neutral',
  checking: 'warning',
  counted: 'success',
  rejected: 'error',
  failed: 'error',
  withdrawn: 'neutral',
  excluded: 'error',
  unknown: 'neutral',
};

/** Строка попытки: статус, происхождение, источник («Файл» / «Garmin» / «Wahoo», F3), время, «Лучший», причина. */
export function attemptView(attempt: MyAttempt): {
  status: string;
  tone: PillTone;
  origin: string | null;
  source: string;
  time: string | null;
  best: boolean;
  detail: string | null;
} {
  const counted = attempt.status === 'counted';
  const source = attempt.activity.source;
  let detail: string | null = null;
  if (attempt.status === 'rejected') {
    detail = t(`races.attempt.reason.${attempt.reasons[0] ?? 'unknown'}`);
  } else if (attempt.status === 'failed') {
    detail = t('races.attempt.failedHint');
  }
  return {
    status: t(`races.attempt.status.${attempt.status}`),
    tone: ATTEMPT_TONES[attempt.status],
    origin: attempt.origin === 'unknown' ? null : t(`races.attempt.origin.${attempt.origin}`),
    source: t(`tracks.source.${source === 'unknown' ? 'upload' : source}`),
    time: counted && attempt.segment ? formatElapsed(attempt.segment.elapsedSec) : null,
    best: counted && attempt.isBest,
    detail,
  };
}

/** Файл, загруженный в гонку и ещё не ставший попыткой: обработка или отказ с причиной; `ready` — без строки. */
export function pendingUploadText(upload: PendingUpload): string | null {
  switch (upload.status) {
    case 'ready':
      return null;
    case 'failed':
    case 'skipped':
    case 'duplicate':
      return t('races.attempt.uploadFailed', { reason: uploadStatus(upload).label });
    default:
      return t('races.attempt.uploadPending');
  }
}

/** Опрос «моего участия» (§7.3): попытка в проверке, незавершённая загрузка или результат `pending`. */
export function needsPolling(entry: MyRaceEntry | null | undefined): boolean {
  if (!entry) return false;
  return (
    entry.result.status === 'pending' ||
    entry.attempts.some((a) => a.status === 'queued' || a.status === 'checking') ||
    entry.pendingUploads.some(isUploadInProgress)
  );
}

/** Подпись результата: изменилась между ответами — таблица перезапрашивается (место появляется тихо, F13). */
export function resultSignature(entry: MyRaceEntry | null | undefined): string | null {
  if (!entry) return null;
  const { status, place, tied, elapsedSec } = entry.result;
  return `${status}|${place ?? ''}|${tied}|${elapsedSec ?? ''}`;
}

const RACE_ERROR_CODES = [
  'RACE_ENTRY_CLOSED',
  'RACE_ENTRY_WITHDRAWN',
  'RACE_ENTRY_REQUIRED',
  'RACE_WITHDRAW_CLOSED',
  'ATTEMPT_UPLOAD_CLOSED',
  'ATTEMPT_LIMIT',
  'ATTEMPT_SOURCE_INVALID',
] as const;
type RaceErrorCode = (typeof RACE_ERROR_CODES)[number];

export const isRaceErrorCode = (code: string | undefined): code is RaceErrorCode =>
  code !== undefined && (RACE_ERROR_CODES as readonly string[]).includes(code);

/** Отказ действия участия: `races.error.<код>`, иначе общий текст (сеть, 429, сбой) — F5. */
export function raceActionErrorText(error: unknown): string {
  const code = apiErrorCode(error);
  return isRaceErrorCode(code) ? t(`races.error.${code}`) : actionErrorMessage(error);
}

/** Строка предварительной таблицы: место («=2» при ничьей), «Участник» / «Вы», время, подпись для скринридера. */
export function resultRow(
  row: RaceResultRow,
  own: boolean,
): { place: string; who: string; time: string; a11y: string } {
  const place = row.tied ? t('races.results.tiePlace', { place: row.place }) : String(row.place);
  const who = t(own ? 'races.results.you' : 'races.results.rider');
  const time = formatElapsed(row.elapsedSec);
  const spoken = row.tied ? t('races.results.tiedA11y', { place: row.place }) : String(row.place);
  return { place, who, time, a11y: t('races.results.rowA11y', { place: spoken, who, time }) };
}
