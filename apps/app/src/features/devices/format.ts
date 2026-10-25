import {
  minskToday,
  utcToMinskWallTime,
  type DeviceView,
  type TrackUpload,
} from '@pokatim/contracts';
import { i18n, t, type MessageKey } from '@pokatim/i18n';
import type { PillTone } from '@rkarakulov/ui';

/**
 * Подписи «Устройств» — чистые функции (`now` — параметр). Время — только `contracts/src/time.ts` (UTC → Минск);
 * пояс устройства не участвует (§4.7). Статусы — с сервера; незнакомое значение (`'unknown'`) — нейтрально.
 */

/** «14 октября, 09:30» по Минску; год — только если не текущий по Минску. */
export function formatMinskDateTime(iso: string, now: Date): string {
  const wall = utcToMinskWallTime(iso);
  const [year, month, day] = wall.slice(0, 10).split('-').map(Number) as [number, number, number];
  const dayMonth = t('format.dayMonth', { day, month: t(`date.month.${month}` as MessageKey) });
  const date =
    year === Number(minskToday(now).slice(0, 4))
      ? dayMonth
      : t('format.dateWithYear', { date: dayMonth, year });
  return t('tracks.dateTime', { date, time: wall.slice(11, 16) });
}

/** «42,1 км» — дистанция в метрах. */
export const formatKm = (meters: number) =>
  t('tracks.km', { distance: i18n.formatNumber(meters / 1000, { maximumFractionDigits: 1 }) });

/** Статус подключения строкой экрана; `issue: 'reauthorize'` важнее статуса. */
export function deviceStatusLabel(device: DeviceView): string {
  if (device.issue === 'reauthorize') return t('devices.status.reauthorize');
  if (device.status === 'unknown') return t('devices.status.not_connected');
  return t(`devices.status.${device.status}`);
}

/** Подключение «живое»: показываем синхронизацию и «Отключить». */
export const isDeviceConnected = (device: DeviceView) =>
  device.status === 'active' || device.status === 'pending';

/**
 * Подключение нужно начать (заново): не подключено, `issue: 'reauthorize'` или `pending` — подтверждение не пришло
 * (браузер авторизации закрыли, OW увёл на свою страницу ошибки); сервер повторный `connect` при `pending` принимает.
 */
export const needsDeviceConnect = (device: DeviceView) =>
  device.issue === 'reauthorize' || device.status === 'pending' || !isDeviceConnected(device);

/** Загрузка ещё обрабатывается — экран опрашивает её статус. */
export const isUploadInProgress = (upload: Pick<TrackUpload, 'status'>) =>
  upload.status === 'queued' || upload.status === 'processing';

const FAILURE_LABELS = {
  unreadable: 'tracks.failure.unreadable',
  no_track: 'tracks.failure.no_track',
  no_timestamps: 'tracks.failure.no_timestamps',
} as const satisfies Partial<Record<NonNullable<TrackUpload['failure']>, MessageKey>>;

const isNamedFailure = (failure: string): failure is keyof typeof FAILURE_LABELS =>
  failure in FAILURE_LABELS;

/**
 * Статус загрузки: «Обрабатываем…», «Готово», «Такой заезд уже есть», причина отказа («Не удалось прочитать файл»,
 * «В файле нет трека», «В файле нет времени»); прочие причины и незнакомые статусы — нейтрально.
 */
export function uploadStatus(upload: Pick<TrackUpload, 'status' | 'failure'>): {
  label: string;
  tone: PillTone;
} {
  switch (upload.status) {
    case 'queued':
    case 'processing':
      return { label: t('tracks.status.processing'), tone: 'neutral' };
    case 'ready':
      return { label: t('tracks.status.ready'), tone: 'success' };
    case 'duplicate':
      return { label: t('tracks.status.duplicate'), tone: 'neutral' };
    case 'failed':
    case 'skipped': {
      const failure = upload.failure;
      if (failure !== null && isNamedFailure(failure)) {
        return { label: t(FAILURE_LABELS[failure]), tone: 'error' };
      }
      return upload.status === 'failed'
        ? { label: t('tracks.status.failed'), tone: 'error' }
        : { label: t('tracks.status.skipped'), tone: 'neutral' };
    }
    default:
      return { label: t('tracks.status.processing'), tone: 'neutral' };
  }
}

/** Заголовок строки загрузки: имя файла; без имени — источник («Garmin», «Wahoo»). */
export function uploadTitle(upload: Pick<TrackUpload, 'fileName' | 'source'>): string {
  if (upload.fileName) return upload.fileName;
  return upload.source === 'unknown'
    ? t('tracks.source.upload')
    : t(`tracks.source.${upload.source}`);
}

/** Мета строки: «14 октября, 09:30 · 42,1 км»; без активности (обработка, отказ) — пусто. */
export function uploadMeta(upload: Pick<TrackUpload, 'activity'>, now: Date): string | null {
  const activity = upload.activity;
  if (!activity) return null;
  return t('format.metaJoin', {
    head: formatMinskDateTime(activity.startedAt, now),
    next: formatKm(activity.distanceM),
  });
}
