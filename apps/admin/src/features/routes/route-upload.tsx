import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { type PanelRoute, ROUTE_FILE_EXTENSIONS, ROUTE_FILE_MAX_BYTES } from '@pokatim/contracts';
import { type MessageKey, t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { fieldErrorText, serverFieldErrors } from '../../field-errors';
import { Button, Dialog, TextField } from '../../ui';
import { ROUTE_POLL_MAX_MS, ROUTE_POLL_MS, ROUTES_QUERY_KEY, routeQuery } from './routes-query';

/** Ответы загрузки с текстом под полем окна (остальное — «Не удалось сохранить»). */
const UPLOAD_ERRORS: Partial<Record<string, MessageKey>> = {
  ROUTE_FORMAT_UNSUPPORTED: 'admin.routes.error.ROUTE_FORMAT_UNSUPPORTED',
  ROUTE_TOO_LARGE: 'admin.routes.error.ROUTE_TOO_LARGE',
  RATE_LIMITED: 'admin.routes.error.RATE_LIMITED',
};

function uploadErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('error.network');
  const titleCode = serverFieldErrors(error)?.find((field) => field.path === 'title')?.code;
  if (titleCode) return fieldErrorText(titleCode) ?? t('admin.saveFailed');
  const key = UPLOAD_ERRORS[apiErrorOf(error)?.code ?? ''];
  return key ? t(key) : t('admin.saveFailed');
}

/** Фильтр окна выбора файла маршрута (`.gpx,.kml,.kmz,.tcx`); формат проверяет сервер по содержимому. */
export const ROUTE_FILE_ACCEPT = ROUTE_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(
  ',',
);

/** Название по умолчанию — имя файла без расширения (Q4). */
const titleOf = (file: File) => file.name.replace(/\.[^.]+$/, '').trim();

export interface RouteUpload {
  /** Выбранный файл — окно «Новый маршрут» открыто. */
  file: File | undefined;
  title: string;
  setTitle: (title: string) => void;
  /** Ошибка под полем окна (размер, формат, название, сеть). */
  error: string | undefined;
  isUploading: boolean;
  /** Выбор файла (`FileButton.onFile`): pre-check размера, название из имени файла. */
  chooseFile: (file: File) => void;
  submit: () => void;
  close: () => void;
  /** Загруженный маршрут под опросом статуса (`undefined` — опроса нет или ответа ещё нет). */
  pending: PanelRoute | undefined;
  /** Опрос идёт (маршрут загружен). */
  polling: boolean;
  /** Предел ожидания `ROUTE_POLL_MAX_MS` истёк по часам. */
  pollExpired: boolean;
  /** Запрос статуса упал после повторов (до истечения предела). */
  pollFailed: boolean;
  /** Сбросить опрос (ручной выбор другого маршрута). */
  reset: () => void;
}

/**
 * Загрузка маршрута GPX, KML, KMZ или TCX в панели (RC-15): окно «Новый маршрут» → `POST /v1/admin/routes` → опрос статуса каждые 2 с, пока
 * `processing`, не дольше 5 мин по часам — и при сплошных ошибках запросов. Готов — `onReady` один раз на загрузку;
 * готов или отказ — списки маршрутов (`ROUTES_QUERY_KEY`) обновляются. Используют «Эталонный коридор» гонки и экран
 * «Маршруты».
 */
export function useRouteUpload(onReady?: (route: PanelRoute) => void): RouteUpload {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File>();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string>();
  const [pendingId, setPendingId] = useState<string>();
  /** Момент начала опроса загруженного маршрута (мс) — предел ожидания `ROUTE_POLL_MAX_MS` по часам, не по ответам. */
  const [pendingSince, setPendingSince] = useState(0);
  /** Предел ожидания истёк (таймер): опрос остановлен и при сплошных ошибках запросов. */
  const [pollExpired, setPollExpired] = useState(false);

  // опрос загруженного маршрута: каждые 2 с, пока `processing`; три сбоя подряд (повторы запроса) — баннер
  const poll = useQuery({
    ...routeQuery(pendingId ?? ''),
    enabled: pendingId !== undefined,
    retry: 2,
    retryDelay: ROUTE_POLL_MS,
    refetchInterval: (query) => {
      if (query.state.data && query.state.data.status !== 'processing') return false;
      return Date.now() - pendingSince >= ROUTE_POLL_MAX_MS ? false : ROUTE_POLL_MS;
    },
  });
  const pending = pendingId ? poll.data : undefined;
  useEffect(() => {
    if (pendingId === undefined) return;
    const timer = setTimeout(
      () => setPollExpired(true),
      Math.max(pendingSince + ROUTE_POLL_MAX_MS - Date.now(), 0),
    );
    return () => clearTimeout(timer);
  }, [pendingId, pendingSince]);
  // обработка завершилась — один раз на загрузку: готов → `onReady`, списки маршрутов — заново
  const settled = useRef<string>(undefined);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  }, [onReady]);
  useEffect(() => {
    if (!pending || pending.status === 'processing') return;
    const mark = `${pending.id}:${pending.status}`;
    if (settled.current === mark) return;
    settled.current = mark;
    if (pending.status === 'ready') {
      readyRef.current?.(pending);
      void queryClient.invalidateQueries({ queryKey: [...ROUTES_QUERY_KEY, 'ready'] });
    }
    void queryClient.invalidateQueries({ queryKey: [...ROUTES_QUERY_KEY, 'list'] });
  }, [pending, queryClient]);

  const upload = useMutation({
    mutationFn: ({ bytes, name }: { bytes: File; name: string }) => api.uploadRoute(bytes, name),
    onSuccess: (route) => {
      // новый цикл загрузки: тот же файл после «Без коридора» снова выбирает свой маршрут
      settled.current = undefined;
      setPendingSince(Date.now());
      setPollExpired(false);
      queryClient.setQueryData(routeQuery(route.id).queryKey, route);
      void queryClient.invalidateQueries({ queryKey: [...ROUTES_QUERY_KEY, 'list'] });
      setFile(undefined);
      setPendingId(route.id);
    },
    onError: (failure) => setError(uploadErrorText(failure)),
  });

  return {
    file,
    title,
    setTitle,
    error,
    isUploading: upload.isPending,
    chooseFile: (chosen) => {
      setError(
        chosen.size > ROUTE_FILE_MAX_BYTES ? t('admin.routes.error.ROUTE_TOO_LARGE') : undefined,
      );
      setTitle(titleOf(chosen));
      setFile(chosen);
    },
    submit: () => {
      if (!file || file.size > ROUTE_FILE_MAX_BYTES || upload.isPending) return;
      if (title.trim() === '') {
        setError(fieldErrorText('REQUIRED'));
        return;
      }
      setError(undefined);
      upload.mutate({ bytes: file, name: title.trim() });
    },
    close: () => {
      if (upload.isPending) return;
      setFile(undefined);
      setError(undefined);
    },
    pending,
    polling: pendingId !== undefined,
    pollExpired,
    pollFailed: pendingId !== undefined && poll.isError && !pollExpired,
    reset: () => setPendingId(undefined),
  };
}

/**
 * Окно «Новый маршрут»: название (по умолчанию — имя файла) и «Загрузить». Без вложенного `<form>`: окно бывает
 * внутри формы гонки, отправка вложенной формы перезагрузила бы страницу; Enter в поле — та же отправка.
 */
export function RouteUploadDialog({ upload }: { upload: RouteUpload }) {
  return (
    <Dialog
      open={upload.file !== undefined}
      title={t('admin.routes.dialog.title')}
      onClose={upload.close}
    >
      <TextField
        label={t('admin.routes.field.title')}
        autoComplete="off"
        value={upload.title}
        onChange={(event) => upload.setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          upload.submit();
        }}
        error={upload.error}
      />
      <div className="dialog__actions">
        <Button onClick={upload.close} disabled={upload.isUploading}>
          {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
        </Button>
        <Button variant="primary" busy={upload.isUploading} onClick={upload.submit}>
          {t('admin.routes.dialog.submit')}
        </Button>
      </div>
    </Dialog>
  );
}
