import type { TrackFormat } from '@pokatim/contracts';

import { randomToken } from '../identity';

/** Файл хранилища (для уборки «файлы без документа»). */
export interface StoredTrackFile {
  key: string;
  modifiedAt: Date;
}

/**
 * Порт хранилища исходников заездов (R8): на dev и в тестах — файловая система (`FsTrackFileStore`), до прода —
 * S3-адаптер. Исходник хранится без изменений; наружу файлы не выдаются (ключи непредсказуемы).
 */
export interface TrackFileStore {
  /** Атомарная запись: временное имя → `rename`; повторный `put` того же ключа перезаписывает. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Нет файла — не ошибка (повтор удаления). */
  delete(key: string): Promise<void>;
  /** Свободное место тома, байт. */
  freeBytes(): Promise<number>;
  /** Все файлы хранилища (уборка сирот); временные файлы недописанных `put` тоже видны. */
  list(): AsyncIterable<StoredTrackFile>;
  /** Удалить файл по ключу из `list()` (в том числе временный). */
  deleteListed(key: string): Promise<void>;
}

export const TRACK_FILE_STORE = Symbol('TRACK_FILE_STORE');

const EXTENSION: Record<TrackFormat, string> = {
  fit: 'fit',
  gpx: 'gpx',
  stream: 'stream.json.gz',
};

/** Ключ исходника: `<2 символа>/<randomToken>.<расширение>` — не из `userId`/времени, не угадывается. */
export function newStorageKey(format: TrackFormat): string {
  const token = randomToken();
  return `${token.slice(0, 2)}/${token}.${EXTENSION[format]}`;
}

/** Ключ, который мог выдать `newStorageKey` (защита от обхода каталога при чтении из БД). */
export const STORAGE_KEY = /^[A-Za-z0-9_-]{2}\/[A-Za-z0-9_-]{43}\.(fit|gpx|stream\.json\.gz)$/;
