import { TRACK_FILE_EXTENSIONS } from '@pokatim/contracts';
import { getDocumentAsync } from 'expo-document-picker';

import type { PickedTrackFile } from './picked-track-file';

/**
 * Системный выбор файла (web, `<input type="file">`): фильтр по расширениям (заезды — `.fit`/`.gpx`, маршруты —
 * `.gpx`/`.kml`), без чтения в base64 — отправляется сам `File`. Отмена — `null`.
 */
export async function pickTrackFile(
  extensions: readonly string[] = TRACK_FILE_EXTENSIONS,
): Promise<PickedTrackFile | null> {
  const result = await getDocumentAsync({
    type: extensions.map((extension) => `.${extension}`),
    multiple: false,
    base64: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset?.file) return null;
  return { name: asset.name, size: asset.file.size, uri: asset.uri, file: asset.file };
}
