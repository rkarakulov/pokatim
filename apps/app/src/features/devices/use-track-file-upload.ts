import type { TrackUpload, TrackUploadPage } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { precheckTrackFile } from '@pokatim/tracks';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';

import { deviceActionErrorMessage } from './error-messages';
import { pickTrackFile } from './pick-track-file';
import { devicesKeys } from './queries';
import { sendTrackFile, UploadCanceledError, uploadName } from './send-track-file';
import { trackFileBody } from './upload-track';

export type TrackFileUploadState =
  | { phase: 'idle' }
  /** pre-check или ответ сервера отклонили файл — текст причины */
  | { phase: 'failed'; message: string }
  | { phase: 'uploading'; name: string; progress: number }
  /** байты приняты: дальше статус обработки — из списка загрузок (опрос) */
  | { phase: 'sent'; name: string; upload: TrackUpload };

export interface TrackFileUploadOptions {
  /** байты приняты сервером (только для текущей отправки): загрузка в гонку делает второй шаг — попытку */
  onUploaded?: (upload: TrackUpload) => void;
}

/**
 * Загрузка файла заезда: системный выбор → pre-check (`@pokatim/tracks`: расширение, пустой, > 16 МБ — без запроса) →
 * отправка с прогрессом и «Отменить» → загрузка в начало списка (его опрос ведёт «Обрабатываем…» → «Готово»).
 * Без resumable-очереди (v1, task.md §8.2): уход с экрана прерывает отправку.
 */
export function useTrackFileUpload(options: TrackFileUploadOptions = {}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TrackFileUploadState>({ phase: 'idle' });
  const active = useRef<AbortController | null>(null);
  // колбэк — через ref: `choose` не пересоздаётся на каждый рендер владельца
  const onUploaded = useRef(options.onUploaded);
  useEffect(() => {
    onUploaded.current = options.onUploaded;
  }, [options.onUploaded]);

  useEffect(() => () => active.current?.abort(), []);

  const choose = useCallback(async () => {
    const file = await pickTrackFile();
    if (!file) return;
    const check = precheckTrackFile(file);
    if (check !== 'ok') {
      setState({ phase: 'failed', message: t(`tracks.precheck.${check}`) });
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    const isCurrent = () => active.current === controller;
    setState({ phase: 'uploading', name: file.name, progress: 0 });
    try {
      const body = await trackFileBody(file);
      const upload = await withAccessToken((token) =>
        sendTrackFile(api.trackUploadRequest(token, uploadName(file.name)), body, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (isCurrent()) setState({ phase: 'uploading', name: file.name, progress });
          },
        }),
      );
      if (!isCurrent()) return;
      queryClient.setQueryData<TrackUploadPage>(devicesKeys.uploads, (page) =>
        page
          ? { ...page, items: [upload, ...page.items.filter((item) => item.id !== upload.id)] }
          : page,
      );
      void queryClient.invalidateQueries({ queryKey: devicesKeys.uploads });
      setState({ phase: 'sent', name: file.name, upload });
      onUploaded.current?.(upload);
    } catch (error) {
      if (error instanceof UploadCanceledError || !isCurrent()) return;
      setState({ phase: 'failed', message: deviceActionErrorMessage(error) });
    } finally {
      if (isCurrent()) active.current = null;
    }
  }, [queryClient]);

  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setState({ phase: 'idle' });
  }, []);

  return { state, choose, cancel };
}
