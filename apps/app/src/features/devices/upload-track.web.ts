import type { PickedTrackFile } from './picked-track-file';

/** Тело отправки (web): сам `File` из выбора файла — без копирования в память; XHR отправляет его с прогрессом. */
export async function trackFileBody(file: PickedTrackFile): Promise<Blob> {
  if (file.file) return file.file;
  const response = await fetch(file.uri);
  return response.blob();
}
