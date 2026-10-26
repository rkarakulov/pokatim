import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { type PanelRace, type PanelRoute, ROUTE_FILE_MAX_BYTES } from '@pokatim/contracts';
import { type MessageKey, t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { fieldErrorText, serverFieldErrors } from '../../field-errors';
import { formatKmFromMeters } from '../../format';
import {
  Banner,
  Button,
  Dialog,
  FileButton,
  LinePreview,
  LockMark,
  ReadonlyField,
  SelectField,
  TextField,
} from '../../ui';
import {
  readyRoutesQuery,
  ROUTE_POLL_MAX_MS,
  ROUTE_POLL_MS,
  ROUTES_QUERY_KEY,
  routeQuery,
} from './routes-query';

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

/** Название по умолчанию — имя файла без расширения (Q4). */
const titleOf = (file: File) => file.name.replace(/\.[^.]+$/, '').trim();

/** Длина, набор и «Круговой» под превью. */
function routeMeta(route: PanelRoute): string {
  const parts = [route.distanceM !== null ? formatKmFromMeters(route.distanceM) : ''];
  if (route.elevationGainM !== null) {
    parts.push(t('admin.races.corridor.elevation', { gain: route.elevationGainM }));
  }
  if (route.isLoop) parts.push(t('admin.races.corridor.loop'));
  return parts.filter(Boolean).join(' · ');
}

/** Превью выбранного маршрута: скелетон блока, ошибка с повтором, линия с длиной (§7 «Состояния»). */
function RoutePreview({ routeId }: { routeId: string }) {
  const state = useQuery(routeQuery(routeId));
  const route = state.data;
  if (!route) {
    return state.isError ? (
      <div className="corridor-preview" role="alert">
        <p className="t-meta">
          {isNetworkError(state.error)
            ? t('state.errorTitle')
            : t('admin.races.corridor.previewFailed')}
        </p>
        <Button size="sm" onClick={() => void state.refetch()}>
          {t('state.retry')}
        </Button>
      </div>
    ) : (
      <div className="corridor-preview">
        <span className="skeleton corridor-preview__skeleton" />
      </div>
    );
  }
  if (route.status !== 'ready') return null;
  return (
    <div className="corridor-preview">
      {state.isError ? (
        <Banner
          tone="error"
          role="alert"
          title={t('admin.races.corridor.previewRefreshFailed')}
          actions={
            <Button size="sm" onClick={() => void state.refetch()}>
              {t('state.retry')}
            </Button>
          }
        />
      ) : null}
      <LinePreview
        points={route.line}
        label={t('admin.races.corridor.previewLabel', {
          title: route.title,
          distance: route.distanceM !== null ? formatKmFromMeters(route.distanceM) : '',
        })}
      />
      <p className="corridor-preview__meta t-meta">{routeMeta(route)}</p>
    </div>
  );
}

export interface CorridorFieldProps {
  /** id выбранного маршрута; `''` — без коридора. */
  value: string;
  onChange: (routeId: string) => void;
  /** Коридор зафиксирован (`editable.fields` без `corridor`). */
  locked: boolean;
  /** Коридор сохранённой гонки — название маршрута, даже если его нет в списке готовых. */
  current: PanelRace['corridor'] | undefined;
  error?: string;
}

/**
 * Поле «Эталонный коридор»: выбор готового маршрута платформы или «Без коридора», «Загрузить GPX» → окно «Новый
 * маршрут» → «Обрабатываем маршрут…» (опрос статуса) → маршрут выбран; отказ — причина под полем. Превью — линия
 * маршрута без карты. Зафиксированный коридор — только чтение с замком. Готовность маршрута проверяет сервер.
 */
export function CorridorField({ value, onChange, locked, current, error }: CorridorFieldProps) {
  const queryClient = useQueryClient();
  const routes = useQuery({ ...readyRoutesQuery, enabled: !locked });
  const [file, setFile] = useState<File>();
  const [title, setTitle] = useState('');
  const [uploadError, setUploadError] = useState<string>();
  const [pendingId, setPendingId] = useState<string>();
  /** Момент начала опроса загруженного маршрута (мс) — предел ожидания `ROUTE_POLL_MAX_MS`. */
  const [pendingSince, setPendingSince] = useState(0);

  // опрос загруженного маршрута: каждые 2 с, пока `processing`; три сбоя подряд (повторы запроса) — баннер
  const poll = useQuery({
    ...routeQuery(pendingId ?? ''),
    enabled: pendingId !== undefined,
    retry: 2,
    retryDelay: ROUTE_POLL_MS,
    refetchInterval: (query) => {
      if (query.state.data && query.state.data.status !== 'processing') return false;
      return query.state.dataUpdatedAt - pendingSince >= ROUTE_POLL_MAX_MS ? false : ROUTE_POLL_MS;
    },
  });
  const pending = pendingId ? poll.data : undefined;
  const pollExpired =
    pending?.status === 'processing' && poll.dataUpdatedAt - pendingSince >= ROUTE_POLL_MAX_MS;
  // маршрут готов — один раз выбрать его в поле и обновить список вариантов
  const selected = useRef<string>(undefined);
  useEffect(() => {
    if (pending?.status !== 'ready' || selected.current === pending.id) return;
    selected.current = pending.id;
    onChange(pending.id);
    void queryClient.invalidateQueries({ queryKey: [...ROUTES_QUERY_KEY, 'ready'] });
  }, [pending, onChange, queryClient]);
  const failed = pending?.status === 'failed' ? pending : undefined;

  const upload = useMutation({
    mutationFn: ({ bytes, name }: { bytes: File; name: string }) => api.uploadRoute(bytes, name),
    onSuccess: (route) => {
      // новый цикл загрузки: тот же файл после «Без коридора» снова выбирает свой маршрут
      selected.current = undefined;
      setPendingSince(Date.now());
      queryClient.setQueryData(routeQuery(route.id).queryKey, route);
      setFile(undefined);
      setPendingId(route.id);
    },
    onError: (failure) => setUploadError(uploadErrorText(failure)),
  });

  const chooseFile = (chosen: File) => {
    setUploadError(
      chosen.size > ROUTE_FILE_MAX_BYTES ? t('admin.routes.error.ROUTE_TOO_LARGE') : undefined,
    );
    setTitle(titleOf(chosen));
    setFile(chosen);
  };
  const submitUpload = () => {
    if (!file || file.size > ROUTE_FILE_MAX_BYTES || upload.isPending) return;
    if (title.trim() === '') {
      setUploadError(fieldErrorText('REQUIRED'));
      return;
    }
    setUploadError(undefined);
    upload.mutate({ bytes: file, name: title.trim() });
  };
  const closeDialog = () => {
    if (upload.isPending) return;
    setFile(undefined);
    setUploadError(undefined);
  };

  const label = t('admin.races.field.corridor');
  const items = routes.data?.items ?? [];
  const options = [
    { value: '', label: t('admin.races.corridor.none') },
    ...items.map((route) => ({ value: route.id, label: route.title })),
  ];
  // сохранённый маршрут гонки — вариант поля, даже если его нет на странице готовых
  if (current && !items.some((route) => route.id === current.route.id)) {
    options.push({ value: current.route.id, label: current.route.title });
  }
  // только что готовый маршрут — вариант сразу, до обновления списка
  if (pending?.status === 'ready' && !options.some((option) => option.value === pending.id)) {
    options.push({ value: pending.id, label: pending.title });
  }
  const selectedTitle = options.find((option) => option.value === value)?.label ?? '';
  const failureText = failed?.failure ? t(`admin.routes.failure.${failed.failure}`) : undefined;
  const fieldError = failureText ?? error;

  let picker: ReactNode;
  if (locked) {
    picker = (
      <ReadonlyField
        label={
          <>
            {label} <LockMark label={t('admin.locked')} />
          </>
        }
        value={value ? selectedTitle : t('admin.races.corridor.none')}
      />
    );
  } else if (!routes.data) {
    picker = routes.isError ? (
      <div className="field" role="alert">
        <div className="field__label t-label">{label}</div>
        <p className="field__error t-meta">
          {isNetworkError(routes.error) ? t('state.errorTitle') : t('admin.routes.listFailed')}
        </p>
        <Button size="sm" onClick={() => void routes.refetch()}>
          {t('state.retry')}
        </Button>
      </div>
    ) : (
      <div className="field">
        <div className="field__label t-label">{label}</div>
        <span className="skeleton field__control"> </span>
      </div>
    );
  } else {
    picker = (
      <div className="corridor-picker">
        <SelectField
          label={label}
          options={options}
          value={value}
          onChange={(event) => {
            // ручной выбор снимает статус и причину отказа последней загрузки
            setPendingId(undefined);
            onChange(event.target.value);
          }}
          error={fieldError}
          help={t('admin.races.corridor.hint')}
        />
        <FileButton
          label={failed ? t('admin.races.corridor.uploadOther') : t('admin.races.corridor.upload')}
          accept=".gpx"
          onFile={chooseFile}
        />
      </div>
    );
  }

  return (
    <>
      {routes.data && routes.isError ? (
        <Banner
          tone="error"
          role="alert"
          title={t('admin.routes.listRefreshFailed')}
          actions={
            <Button size="sm" onClick={() => void routes.refetch()}>
              {t('state.retry')}
            </Button>
          }
        />
      ) : null}
      {picker}
      {pending?.status === 'processing' ? (
        <p className="field__help t-meta" role="status">
          {pollExpired
            ? t('admin.races.corridor.processingLong')
            : t('admin.races.corridor.processing')}
        </p>
      ) : null}
      {pendingId && poll.isError ? (
        <Banner tone="warning" role="status">
          {t('admin.races.corridor.pollFailed')}
        </Banner>
      ) : null}
      {value ? <RoutePreview routeId={value} /> : null}

      <Dialog
        open={file !== undefined}
        title={t('admin.routes.dialog.title')}
        onClose={closeDialog}
      >
        {/* без вложенного <form>: окно — внутри формы гонки, отправка вложенной формы перезагрузила бы страницу */}
        <TextField
          label={t('admin.routes.field.title')}
          autoComplete="off"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submitUpload();
          }}
          error={uploadError}
        />
        <div className="dialog__actions">
          <Button onClick={closeDialog} disabled={upload.isPending}>
            {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
          </Button>
          <Button variant="primary" busy={upload.isPending} onClick={submitUpload}>
            {t('admin.routes.dialog.submit')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
