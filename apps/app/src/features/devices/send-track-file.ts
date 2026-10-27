import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { ApiError, TrackUpload, TrackUploadName } from '@pokatim/contracts';
import type { z } from 'zod';

/** Пользователь нажал «Отменить»: запрос прерван, ошибки на экране нет. */
export class UploadCanceledError extends Error {
  constructor() {
    super('upload canceled');
    this.name = 'UploadCanceledError';
  }
}

export interface UploadRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
}

export interface SendOptions {
  /** доля отправленных байт 0…1 */
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Отправка байт файла с прогрессом: `XMLHttpRequest` (`upload.onprogress`) есть и в браузере, и в React Native — fetch
 * прогресса отправки не даёт. Ответ — схема вызывающего (`TrackUpload`, `MyRoute`) и те же ошибки, что у api-client:
 * `ApiHttpError` (код из контракта), `ApiNetworkError` (нет сети — «Нет соединения»); отмена — `UploadCanceledError`.
 */
export function sendFile<T>(
  request: UploadRequest,
  body: Blob,
  schema: z.ZodType<T>,
  { onProgress, signal }: SendOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadCanceledError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort);
    const settle = () => signal.removeEventListener('abort', abort);

    xhr.open(request.method, request.url);
    for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      settle();
      const payload = parseBody(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = schema.safeParse(payload);
        if (parsed.success) resolve(parsed.data);
        else reject(new ApiHttpError(xhr.status, payload, ApiError));
        return;
      }
      reject(new ApiHttpError(xhr.status, payload, ApiError));
    };
    xhr.onerror = () => {
      settle();
      reject(new ApiNetworkError(new TypeError('Network request failed')));
    };
    xhr.onabort = () => {
      settle();
      reject(new UploadCanceledError());
    };
    xhr.send(body);
  });
}

/** Файл заезда (`POST /v1/tracks/uploads`): ответ — `TrackUpload`. */
export const sendTrackFile = (
  request: UploadRequest,
  body: Blob,
  options: SendOptions,
): Promise<TrackUpload> => sendFile(request, body, TrackUpload, options);

/** `?name=` — исходное имя только для показа: длиннее 120 символов — обрезается, недопустимое — не передаётся. */
export function uploadName(fileName: string): string | undefined {
  const name = fileName.trim().slice(-120);
  return TrackUploadName.safeParse(name).success ? name : undefined;
}
