import { MyRoute } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { precheckRouteFile, ROUTE_FILE_EXTENSIONS } from '@pokatim/tracks';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { pickTrackFile } from '@/features/devices/pick-track-file';
import type { PickedTrackFile } from '@/features/devices/picked-track-file';
import { sendFile, UploadCanceledError } from '@/features/devices/send-track-file';
import { trackFileBody } from '@/features/devices/upload-track';
import { api } from '@/lib/api';

import { myRouteErrorMessage } from './error-messages';
import { defaultRouteTitle, routeTitleError } from './my-route-format';
import { myRoutesKeys, withRouteOnTop } from './my-routes-queries';

export type MyRouteUploadState =
  | { phase: 'idle' }
  /** файл выбран: шаг «Название» (по умолчанию — имя файла); `error` — текст под полем */
  | { phase: 'naming'; file: PickedTrackFile; title: string; error?: string }
  | { phase: 'uploading'; name: string; progress: number }
  /** pre-check или ответ сервера отклонили файл — текст причины */
  | { phase: 'failed'; message: string };

/**
 * Загрузка своего маршрута (routes-02, RC-14): системный выбор (GPX/KML) → pre-check (`@pokatim/tracks`: расширение,
 * пустой, > 5 МиБ — без запроса) → шаг «Название» (имя файла без расширения) → отправка с прогрессом и «Отменить» →
 * маршрут в начале списка (его опрос ведёт «Обрабатывается» → готов). Конвейер — общий с загрузкой заездов.
 */
export function useMyRouteUpload() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<MyRouteUploadState>({ phase: 'idle' });
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  const choose = useCallback(async () => {
    const file = await pickTrackFile(ROUTE_FILE_EXTENSIONS);
    if (!file) return;
    const check = precheckRouteFile(file);
    if (check !== 'ok') {
      setState({ phase: 'failed', message: t(`routes.mine.precheck.${check}`) });
      return;
    }
    setState({ phase: 'naming', file, title: defaultRouteTitle(file.name) });
  }, []);

  const setTitle = useCallback((title: string) => {
    setState((current) => (current.phase === 'naming' ? { ...current, title } : current));
  }, []);

  const submit = useCallback(async () => {
    if (state.phase !== 'naming') return;
    const { file, title } = state;
    const error = routeTitleError(title);
    if (error) {
      setState({ ...state, error });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const isCurrent = () => active.current === controller;
    setState({ phase: 'uploading', name: file.name, progress: 0 });
    try {
      const body = await trackFileBody(file);
      const route = await withAccessToken((token) =>
        sendFile(api.myRouteUploadRequest(token, title.trim()), body, MyRoute, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (isCurrent()) setState({ phase: 'uploading', name: file.name, progress });
          },
        }),
      );
      if (!isCurrent()) return;
      queryClient.setQueryData(myRoutesKeys.list, (data: Parameters<typeof withRouteOnTop>[0]) =>
        withRouteOnTop(data, route),
      );
      void queryClient.invalidateQueries({ queryKey: myRoutesKeys.all });
      setState({ phase: 'idle' });
    } catch (failure) {
      if (failure instanceof UploadCanceledError || !isCurrent()) return;
      setState({ phase: 'failed', message: myRouteErrorMessage(failure) });
    } finally {
      if (isCurrent()) active.current = null;
    }
  }, [state, queryClient]);

  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setState({ phase: 'idle' });
  }, []);

  return { state, choose, setTitle, submit, cancel };
}
