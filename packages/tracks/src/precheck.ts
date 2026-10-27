import {
  ROUTE_FILE_EXTENSIONS,
  ROUTE_FILE_MAX_BYTES,
  TRACK_FILE_EXTENSIONS,
  TRACK_FILE_MAX_BYTES,
} from './track.ts';

export type TrackPrecheckResult = 'ok' | 'extension' | 'empty' | 'too_large';

function precheckFile(
  file: { name: string; size: number },
  extensions: readonly string[],
  maxBytes: number,
): TrackPrecheckResult {
  const dot = file.name.lastIndexOf('.');
  const extension = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
  if (!extensions.includes(extension)) return 'extension';
  if (file.size <= 0) return 'empty';
  if (file.size > maxBytes) return 'too_large';
  return 'ok';
}

/** Быстрая проверка в приложении до отправки; авторитетная проверка — сигнатура на сервере. */
export function precheckTrackFile(file: { name: string; size: number }): TrackPrecheckResult {
  return precheckFile(file, TRACK_FILE_EXTENSIONS, TRACK_FILE_MAX_BYTES);
}

/** То же для файла маршрута (GPX/KML до 5 МиБ, routes-02). */
export function precheckRouteFile(file: { name: string; size: number }): TrackPrecheckResult {
  return precheckFile(file, ROUTE_FILE_EXTENSIONS, ROUTE_FILE_MAX_BYTES);
}
