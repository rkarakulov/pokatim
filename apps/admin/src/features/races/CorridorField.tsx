import { isNetworkError } from '@pokatim/api-client';
import type { PanelRace } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { Banner, Button, FileButton, LockMark, ReadonlyField, SelectField } from '../../ui';
import { RoutePreview } from '../routes/RoutePreview';
import { RouteUploadDialog, useRouteUpload } from '../routes/route-upload';
import { readyRoutesQuery } from '../routes/routes-query';

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
  const routes = useQuery({ ...readyRoutesQuery, enabled: !locked });
  // готовый загруженный маршрут — один раз выбрать его в поле (список вариантов обновляет загрузка)
  const upload = useRouteUpload((route) => onChange(route.id));
  const pending = upload.pending;
  const failed = pending?.status === 'failed' ? pending : undefined;

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
            upload.reset();
            onChange(event.target.value);
          }}
          error={fieldError}
          help={t('admin.races.corridor.hint')}
        />
        <FileButton
          label={failed ? t('admin.races.corridor.uploadOther') : t('admin.races.corridor.upload')}
          accept=".gpx"
          onFile={upload.chooseFile}
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
          {upload.pollExpired
            ? t('admin.races.corridor.processingLong')
            : t('admin.races.corridor.processing')}
        </p>
      ) : null}
      {upload.pollFailed ? (
        <Banner tone="warning" role="status">
          {t('admin.races.corridor.pollFailed')}
        </Banner>
      ) : null}
      {value ? <RoutePreview routeId={value} /> : null}

      <RouteUploadDialog upload={upload} />
    </>
  );
}
