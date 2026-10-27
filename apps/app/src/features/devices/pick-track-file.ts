import { getDocumentAsync } from 'expo-document-picker';

import type { PickedTrackFile } from './picked-track-file';

/**
 * Системный picker (native): у `.fit`/`.kml` нет общего MIME-типа iOS/Android — любой тип, расширение проверяет
 * pre-check (список расширений здесь не нужен — параметр для web-варианта). Файл копируется в кеш приложения
 * (`copyToCacheDirectory`) — отправка читает его по `uri`. Отмена — `null`.
 */
export async function pickTrackFile(
  _extensions?: readonly string[],
): Promise<PickedTrackFile | null> {
  const result = await getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  // размер неизвестен (редкие провайдеры документов) — читаем копию, чтобы pre-check видел настоящий размер
  const size = asset.size ?? (await (await fetch(asset.uri)).blob()).size;
  return { name: asset.name, size, uri: asset.uri };
}
