import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import type { ModerationRideDetail, ModerationRideReport } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { httpStatus, isConflict, isForbidden } from '../../session/errors';
import {
  Banner,
  Button,
  ConflictBanner,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  ReadonlyField,
  ReasonDialog,
  StatusTag,
} from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { RIDE_STATUS_TONE, rideStatusLabel } from './moderation-format';
import { moderationRideQuery, RIDES_MODERATION_QUERY_KEY } from './rides-moderation-query';

const SKELETON_FIELDS = 8;
const column = createColumnHelper<ModerationRideReport>();

type Action = 'hide' | 'restore' | 'dismiss' | 'resetPhoto';
/** Чем вызван баннер конфликта: версия/жалобы райда или фото, которое уже сменилось (ride-photo, R10). */
type Stale = 'ride' | 'photo';

const ACTION_LABEL = {
  hide: 'admin.ridesModeration.hide',
  restore: 'admin.ridesModeration.restore',
  dismiss: 'admin.ridesModeration.dismiss',
  resetPhoto: 'admin.ridesModeration.resetPhoto',
} as const;

const DESTRUCTIVE: readonly Action[] = ['hide', 'resetPhoto'];

const reportColumns = [
  column.accessor('reason', {
    header: t('admin.ridesModeration.report.reason'),
    cell: (info) => t(`domain.rideReportReason.${info.getValue()}`),
    enableSorting: false,
  }),
  column.accessor('comment', {
    header: t('admin.ridesModeration.report.comment'),
    cell: (info) => info.getValue() ?? t('admin.ridesModeration.none'),
    enableSorting: false,
  }),
  column.accessor('createdAt', {
    header: t('admin.ridesModeration.report.createdAt'),
    cell: (info) => formatDateTimeLong(info.getValue()),
    enableSorting: false,
  }),
  column.accessor('resolution', {
    header: t('admin.ridesModeration.report.resolution'),
    cell: (info) => t(`admin.ridesModeration.resolution.${info.getValue() ?? 'open'}`),
    enableSorting: false,
  }),
];

/** Ошибка действия в окне причины (409 — не здесь: баннер конфликта на карточке). */
const actionErrorText = (error: unknown) => {
  if (isNetworkError(error)) return t('error.network');
  return apiErrorOf(error) ? t('admin.saveFailed') : t('error.unknown');
};

/** 409 `CONFLICT` (версия или новая жалоба) и `RIDE_INVALID_STATE` (состояние сменил другой модератор). */
const isStale = (error: unknown) =>
  isConflict(error) ||
  (httpStatus(error) === 409 && apiErrorOf(error)?.code === 'RIDE_INVALID_STATE');

/**
 * Фото организатора (ride-photo): у скрытого райда публичная отдача — 404 (P6), поэтому вместо картинки плашка (R11);
 * id фото в карточке есть, «Удалить фото» доступна.
 */
function RidePhoto({ ride }: { ride: ModerationRideDetail }) {
  if (!ride.photo) return t('admin.ridesModeration.noPhoto');
  if (ride.status === 'hidden') {
    return (
      <span className="ride-photo-preview ride-photo-preview--hidden t-meta">
        {t('admin.ridesModeration.photoHidden')}
      </span>
    );
  }
  return (
    <img
      className="ride-photo-preview"
      src={api.ridePhotoUrl(ride.photo.id)}
      alt={t('admin.ridesModeration.photoAlt', { title: ride.title })}
    />
  );
}

function Preview({ ride }: { ride: ModerationRideDetail }) {
  const none = t('admin.ridesModeration.none');
  return (
    <div className="form-column">
      <div className="form-group">
        <ReadonlyField
          label={t('admin.ridesModeration.column.status')}
          value={
            <StatusTag tone={RIDE_STATUS_TONE[ride.status]}>
              {rideStatusLabel(ride.status)}
            </StatusTag>
          }
        />
        {ride.cancelReason ? (
          <ReadonlyField
            label={t('admin.ridesModeration.field.cancelReason')}
            value={t(`domain.rideCancelReason.${ride.cancelReason}`)}
          />
        ) : null}
        {ride.hiddenAt ? (
          <ReadonlyField
            label={t('admin.ridesModeration.field.hiddenAt')}
            value={formatDateTimeLong(ride.hiddenAt)}
          />
        ) : null}
        <ReadonlyField
          label={t('admin.ridesModeration.field.startsAt')}
          value={formatDateTimeLong(ride.startsAt)}
        />
        <ReadonlyField
          label={t('admin.ridesModeration.field.city')}
          value={t(`domain.city.${ride.city}`)}
        />
        <ReadonlyField label={t('admin.ridesModeration.field.place')} value={ride.place} />
        <ReadonlyField
          label={t('admin.ridesModeration.field.distance')}
          value={t('admin.ridesModeration.distanceValue', { km: ride.distanceKm })}
        />
        <ReadonlyField
          label={t('admin.ridesModeration.field.pace')}
          value={t('admin.ridesModeration.paceValue', {
            min: ride.paceMinKmh,
            max: ride.paceMaxKmh,
          })}
        />
        <ReadonlyField
          label={t('admin.ridesModeration.field.limit')}
          value={ride.limit === null ? t('admin.ridesModeration.noLimit') : String(ride.limit)}
        />
        <ReadonlyField
          label={t('admin.ridesModeration.field.going')}
          value={String(ride.goingCount)}
        />
        <ReadonlyField
          label={t('admin.ridesModeration.field.organizerName')}
          value={ride.organizerName ?? none}
        />
        <ReadonlyField
          label={t('admin.ridesModeration.field.description')}
          value={ride.description ?? none}
          multiline
        />
        <ReadonlyField
          label={t('admin.ridesModeration.field.photo')}
          value={<RidePhoto ride={ride} />}
        />
      </div>
    </div>
  );
}

/**
 * Карточка модерации райда (`rides.moderate`, 05b): превью полей, жалобы (без автора), действия по статусу —
 * `published|cancelled` → «Скрыть» (+ «Отклонить жалобы» при открытых), `hidden` → «Вернуть». Каждое — `ReasonDialog`
 * (причина в журнал); 409 — `ConflictBanner` с перечитыванием карточки. Есть фото организатора — «Удалить фото»
 * при любом статусе (ride-photo, P7): тело несёт `photoId` карточки, фото уже другое — 409 и свой текст баннера (R10).
 */
export function RideModerationScreen({ rideId }: { rideId: string }) {
  const queryClient = useQueryClient();
  const ride = useQuery(moderationRideQuery(rideId));
  const [action, setAction] = useState<Action>();
  const [stale, setStale] = useState<Stale>();

  const crumb = (
    <Link className="link" to="/rides-moderation">
      {t('admin.ridesModeration.title')}
    </Link>
  );

  if (!ride.data) {
    if (ride.isError || ride.fetchStatus === 'paused') {
      if (isForbidden(ride.error)) return <NoAccessScreen />;
      return (
        <>
          <PageHeader crumb={crumb} title={t('admin.ridesModeration.title')} />
          <div className="page-body">
            {httpStatus(ride.error) === 404 ? (
              <EmptyState title={t('admin.ridesModeration.notFound')} />
            ) : (
              <ErrorState
                error={ride.error}
                offline={ride.fetchStatus === 'paused'}
                onRetry={() => void ride.refetch()}
              />
            )}
          </div>
        </>
      );
    }
    return (
      <>
        <PageHeader crumb={crumb} title={<span className="skeleton"> </span>} />
        <div className="page-body form-column" aria-busy="true">
          {Array.from({ length: SKELETON_FIELDS }, (_, index) => (
            <div key={index} className="field" data-testid="skeleton-field">
              <span className="skeleton t-label"> </span>
              <span className="skeleton table__skeleton field__control"> </span>
            </div>
          ))}
        </div>
      </>
    );
  }

  const data = ride.data;
  const hidden = data.status === 'hidden';
  const statusActions: Action[] = hidden
    ? ['restore']
    : data.openReportCount > 0
      ? ['hide', 'dismiss']
      : ['hide'];
  const actions: Action[] = data.photo ? [...statusActions, 'resetPhoto'] : statusActions;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: RIDES_MODERATION_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };
  const reload = async () => {
    await ride.refetch();
    setStale(undefined);
  };
  const run = async (reason: string) => {
    const body = { version: data.version, reason };
    try {
      if (action === 'resetPhoto' && data.photo) {
        await api.resetRidePhoto(data.id, { photoId: data.photo.id, reason });
      } else if (action === 'hide') await api.hideRide(data.id, body);
      else if (action === 'restore') await api.restoreRide(data.id, body);
      else if (action === 'dismiss' && data.lastReportAt) {
        await api.dismissRideReports(data.id, { ...body, lastReportAt: data.lastReportAt });
      }
    } catch (error) {
      if (!isStale(error)) throw error;
      setStale(action === 'resetPhoto' ? 'photo' : 'ride');
      return;
    }
    await refresh();
  };

  return (
    <>
      <PageHeader
        crumb={crumb}
        title={data.title}
        actions={actions.map((value) => (
          <Button
            key={value}
            variant={DESTRUCTIVE.includes(value) ? 'danger' : 'secondary'}
            onClick={() => setAction(value)}
          >
            {t(ACTION_LABEL[value])}
          </Button>
        ))}
      />
      <div className="page-body">
        {stale === 'photo' ? (
          <ConflictBanner
            busy={ride.isFetching}
            title={t('admin.ridesModeration.photoConflict')}
            message={t('admin.ridesModeration.photoConflictMessage')}
            onReload={() => void reload()}
          />
        ) : stale ? (
          <ConflictBanner busy={ride.isFetching} onReload={() => void reload()} />
        ) : null}
        <Preview ride={data} />
        <h2 className="form-group__title t-label">{t('admin.ridesModeration.reportsTitle')}</h2>
        <DataTable
          caption={t('admin.ridesModeration.reportsTitle')}
          columns={reportColumns}
          query={{ data: data.reports, isError: false, error: null, refetch: () => ride.refetch() }}
          getRowId={(report) => report.id}
          empty={<EmptyState title={t('admin.ridesModeration.noReports')} />}
        />
      </div>
      <ReasonDialog
        open={action !== undefined}
        title={action ? t(`admin.ridesModeration.${action}Title`, { title: data.title }) : ''}
        consequences={action ? t(`admin.ridesModeration.${action}Consequences`) : ''}
        extraFields={
          action === 'resetPhoto' ? (
            <Banner tone="warning">{t('admin.ridesModeration.reasonWarning')}</Banner>
          ) : undefined
        }
        confirmLabel={action ? t(ACTION_LABEL[action]) : ''}
        destructive={action !== undefined && DESTRUCTIVE.includes(action)}
        errorText={actionErrorText}
        onConfirm={run}
        onClose={() => setAction(undefined)}
      />
    </>
  );
}
