import type { PickedTrackFile } from './picked-track-file';

/**
 * Тело отправки (native): копия файла в кеше приложения (`file://`) читается в `Blob` через `fetch` React Native —
 * XHR отправляет его как есть и сообщает прогресс (`send-track-file.ts`). Без `expo-file-system`: upload task с
 * прогрессом там есть, но это новая нативная зависимость ради того же результата.
 */
export async function trackFileBody(file: PickedTrackFile): Promise<Blob> {
  const response = await fetch(file.uri);
  return response.blob();
}
