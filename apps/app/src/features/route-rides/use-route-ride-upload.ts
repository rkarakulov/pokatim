import {
  TRACK_UPLOAD_FINAL_STATUSES,
  type RouteRideDetail,
  type TrackUpload,
  type TrackUploadStatus,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { isNetworkError } from '@pokatim/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiErrorCode } from '@/features/auth/error-messages';
import { withAccessToken } from '@/features/auth/authorized';
import { uploadStatus } from '@/features/devices/format';
import { useTrackFileUpload } from '@/features/devices/use-track-file-upload';
import { api } from '@/lib/api';

import { routeRideErrorMessage } from './error-messages';
import {
  routeRidesKeys,
  UPLOAD_READY_POLL_MS,
  UPLOAD_READY_TIMEOUT_MS,
  useCheckRouteRide,
} from './queries';

export type RouteRideUploadPhase =
  | { phase: 'idle' }
  | { phase: 'uploading'; name: string; progress: number }
  /** опрос готовности загрузки (`getTrackUpload`) */
  | { phase: 'processing' }
  /** POST `{ uploadId }` */
  | { phase: 'checking' }
  /** 60 с без финала или `NOT_READY` после повтора */
  | { phase: 'timeout' }
  /** опрос статуса файла не удался (сеть, 5xx, 404) — баннер с повтором опроса; файл заново не отправляется */
  | { phase: 'pollFailed'; network: boolean }
  | { phase: 'failed'; message: string };

type OwnPhase = Exclude<RouteRideUploadPhase, { phase: 'uploading' } | { phase: 'pollFailed' }>;

const isFinal = (upload: TrackUpload | undefined) =>
  upload !== undefined && TRACK_UPLOAD_FINAL_STATUSES.includes(upload.status as TrackUploadStatus);
const isAccepted = (upload: TrackUpload) =>
  upload.status === 'ready' || upload.status === 'duplicate';

/**
 * «Загрузить заезд» для проверки по маршруту (RC-1): файл (`useTrackFileUpload`: выбор, pre-check, прогресс, отмена)
 * → опрос готовности загрузки раз в 2 с (без лимитера проверок) до финального статуса, не дольше 60 с от отправки →
 * один POST `{ uploadId }`. Отказ обработки (`failed`/`skipped`) — без POST; `409 ROUTE_RIDE_NOT_READY` — один повтор
 * через 2 с, затем «Файл ещё обрабатывается». Итого ≤ 2 POST на файл. Уход с экрана — опрос и таймеры прекращаются.
 */
export function useRouteRideUpload(
  routeId: string,
  { onChecked }: { onChecked: (ride: RouteRideDetail) => void },
) {
  const queryClient = useQueryClient();
  const check = useCheckRouteRide(routeId);
  const [own, setOwn] = useState<OwnPhase>({ phase: 'idle' });
  const [sent, setSent] = useState<{ upload: TrackUpload; at: number } | null>(null);
  const submitted = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checked = useRef(onChecked);
  useEffect(() => {
    checked.current = onChecked;
  }, [onChecked]);

  const file = useTrackFileUpload({
    onUploaded: (upload) => {
      // ответ загрузки — свежее кэша: повтор того же файла (тот же id) после таймаута уже `ready`, а `initialData`
      // существующий запрос не перезаписывает
      queryClient.setQueryData(routeRidesKeys.upload(routeId, upload.id), upload);
      submitted.current = null;
      setSent({ upload, at: Date.now() });
      setOwn({ phase: 'processing' });
    },
  });

  const uploadId = sent?.upload.id ?? '';
  const processing = own.phase === 'processing' && sent !== null;
  const uploadKey = routeRidesKeys.upload(routeId, uploadId);
  // ошибка опроса (после ретраев запроса) — внутренняя остановка: запрос выключен (ни интервала, ни фокуса), окно 60 с
  // стоит; «Повторить» (`retryPoll`) — ручной `refetch`, успех снимает ошибку и опрос продолжается с новым окном
  const stalled = queryClient.getQueryState(uploadKey)?.status === 'error';
  const upload = useQuery({
    queryKey: uploadKey,
    queryFn: () => withAccessToken((token) => api.getTrackUpload(token, uploadId)),
    initialData: sent?.upload,
    refetchInterval: (query) => (isFinal(query.state.data) ? false : UPLOAD_READY_POLL_MS),
    // ответ загрузки только что пришёл — первый GET через интервал, не сразу при включении запроса
    staleTime: UPLOAD_READY_POLL_MS,
    // ответ загрузки уже финальный (`200`: тот же файл) — без опроса, сразу POST
    enabled: processing && !isFinal(sent.upload) && !stalled,
  });

  const { mutate, reset } = check;
  const post = useCallback(
    (id: string) => {
      const attempt = (retried: boolean) => {
        setOwn({ phase: 'checking' });
        mutate(
          { uploadId: id },
          {
            onSuccess: (ride) => checked.current(ride),
            onError: (error) => {
              if (apiErrorCode(error) !== 'ROUTE_RIDE_NOT_READY') {
                setOwn({ phase: 'failed', message: routeRideErrorMessage(error) });
              } else if (retried) {
                setOwn({ phase: 'timeout' });
              } else {
                // гонка статусов (загрузка готова, активность ещё нет) — один повтор
                retryTimer.current = setTimeout(() => attempt(true), UPLOAD_READY_POLL_MS);
              }
            },
          },
        );
      };
      attempt(false);
    },
    [mutate],
  );

  // финальный статус загрузки: принят — ровно один POST (сторож — `submitted`); отказ обработки — без POST
  const data = processing ? upload.data : undefined;
  const rejected = data !== undefined && isFinal(data) && !isAccepted(data) ? data : null;
  const pollFailed = processing && upload.isError && !isFinal(data);
  useEffect(() => {
    if (!data || !isFinal(data) || !isAccepted(data) || submitted.current === data.id) return;
    submitted.current = data.id;
    post(data.id);
  }, [data, post]);

  // 60 с от отправки без финала — «откройте выбор позже» (заезд позже появится в кандидатах)
  const sentAt = sent?.at;
  useEffect(() => {
    if (!processing || sentAt === undefined || rejected || pollFailed) return;
    const timer = setTimeout(
      () => setOwn({ phase: 'timeout' }),
      Math.max(0, sentAt + UPLOAD_READY_TIMEOUT_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [processing, sentAt, rejected, pollFailed]);

  // повтор опроса после ошибки: окно 60 с — заново, файл не отправляется
  const { refetch } = upload;
  const retryPoll = useCallback(() => {
    setSent((current) => (current ? { ...current, at: Date.now() } : current));
    void refetch();
  }, [refetch]);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const { choose: chooseFile, cancel: cancelFile } = file;
  const choose = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    reset();
    setSent(null);
    setOwn({ phase: 'idle' });
    void chooseFile();
  }, [reset, chooseFile]);

  const cancel = useCallback(() => {
    cancelFile();
    setOwn({ phase: 'idle' });
  }, [cancelFile]);

  const state: RouteRideUploadPhase =
    file.state.phase === 'uploading'
      ? file.state
      : file.state.phase === 'failed'
        ? { phase: 'failed', message: file.state.message }
        : pollFailed
          ? { phase: 'pollFailed', network: isNetworkError(upload.error) }
          : rejected
            ? {
                phase: 'failed',
                message: t('routes.rides.pick.uploadRejected', {
                  reason: uploadStatus(rejected).label,
                }),
              }
            : own;
  const busy =
    state.phase === 'uploading' || state.phase === 'processing' || state.phase === 'checking';
  return { state, choose, cancel, retryPoll, busy };
}
