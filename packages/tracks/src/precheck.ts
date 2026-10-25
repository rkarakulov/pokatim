import { TRACK_FILE_EXTENSIONS, TRACK_FILE_MAX_BYTES } from './track.ts';

export type TrackPrecheckResult = 'ok' | 'extension' | 'empty' | 'too_large';

/** Быстрая проверка в приложении до отправки; авторитетная проверка — сигнатура на сервере. */
export function precheckTrackFile(file: { name: string; size: number }): TrackPrecheckResult {
  const dot = file.name.lastIndexOf('.');
  const extension = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
  if (!(TRACK_FILE_EXTENSIONS as readonly string[]).includes(extension)) return 'extension';
  if (file.size <= 0) return 'empty';
  if (file.size > TRACK_FILE_MAX_BYTES) return 'too_large';
  return 'ok';
}
