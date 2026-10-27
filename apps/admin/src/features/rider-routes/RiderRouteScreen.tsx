import {
  ROUTE_PUBLICATION_MAX_SUBMISSIONS,
  type RiderRouteModerationDetail,
  type RiderRouteModerationReport,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { createScrubStore } from '@pokatim/route-view';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';

import { formatDateTimeLong } from '../../format';
import { httpStatus, isForbidden } from '../../session/errors';
import {
  Button,
  ConflictBanner,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  ReadonlyField,
  StatusTag,
} from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { RouteReadyView } from '../routes/RouteReadyView';
import {
  ACTION_LABEL,
  ApproveRiderRouteDialog,
  ReasonDecisionDialog,
  RejectRiderRouteDialog,
  type RiderRouteAction,
} from './RiderRouteDecisionDialogs';
import {
  RIDER_ROUTE_STATUS_TONE,
  riderRouteAuthor,
  riderRouteStatusLabel,
} from './rider-routes-format';
import { RIDER_ROUTES_QUERY_KEY, riderRouteQuery } from './rider-routes-query';

const SKELETON_FIELDS = 6;
const column = createColumnHelper<RiderRouteModerationReport>();
const none = () => t('admin.riderRoutes.none');

const reportColumns = [
  column.accessor('reason', {
    header: t('admin.riderRoutes.report.reason'),
    cell: (info) => t(`domain.routeReportReason.${info.getValue()}`),
    enableSorting: false,
  }),
  column.accessor('comment', {
    header: t('admin.riderRoutes.report.comment'),
    cell: (info) => info.getValue() ?? none(),
    enableSorting: false,
  }),
  column.accessor('createdAt', {
    header: t('admin.riderRoutes.report.createdAt'),
    cell: (info) => formatDateTimeLong(info.getValue()),
    enableSorting: false,
  }),
  column.accessor('resolution', {
    header: t('admin.riderRoutes.report.resolution'),
    cell: (info) => t(`admin.riderRoutes.resolution.${info.getValue() ?? 'open'}`),
    enableSorting: false,
  }),
];

/** Действия по состоянию заявки (A1, A5): на проверке — решение, в каталоге — скрыть (и отклонить жалобы), скрыт — вернуть. */
function actionsOf(route: RiderRouteModerationDetail): RiderRouteAction[] {
  switch (route.status) {
    case 'pending':
      return ['approve', 'reject'];
    case 'approved':
      return route.openReportCount > 0 && route.lastReportAt ? ['hide', 'dismiss'] : ['hide'];
    case 'hidden':
      return ['restore'];
    case 'rejected':
      return [];
  }
}

const ACTION_VARIANT = {
  approve: 'primary',
  reject: 'danger',
  hide: 'danger',
  restore: 'secondary',
  dismiss: 'secondary',
} as const;

function Summary({ route }: { route: RiderRouteModerationDetail }) {
  return (
    <div className="form-column">
      <div className="form-group">
        <ReadonlyField
          label={t('admin.riderRoutes.field.status')}
          value={
            <StatusTag tone={RIDER_ROUTE_STATUS_TONE[route.status]}>
              {riderRouteStatusLabel(route.status)}
            </StatusTag>
          }
        />
        <ReadonlyField
          label={t('admin.riderRoutes.field.author')}
          value={riderRouteAuthor(route.authorUserId)}
        />
        <ReadonlyField
          label={t('admin.riderRoutes.field.signature')}
          value={t(
            route.showAuthorName
              ? 'admin.riderRoutes.signature.named'
              : 'admin.riderRoutes.signature.anonymous',
          )}
        />
        <ReadonlyField
          label={t('admin.riderRoutes.field.city')}
          value={t(`domain.city.${route.city}`)}
        />
        <ReadonlyField
          label={t('admin.riderRoutes.field.surfaces')}
          value={
            route.surfaces.map((surface) => t(`domain.surface.${surface}`)).join(', ') || none()
          }
        />
        <ReadonlyField
          label={t('admin.riderRoutes.field.submittedAt')}
          value={formatDateTimeLong(route.submittedAt)}
        />
        <ReadonlyField
          label={t('admin.riderRoutes.field.submissionCount')}
          value={t('admin.riderRoutes.submissionCountValue', {
            count: route.submissionCount,
            max: ROUTE_PUBLICATION_MAX_SUBMISSIONS,
          })}
        />
        {route.decidedAt ? (
          <ReadonlyField
            label={t('admin.riderRoutes.field.decidedAt')}
            value={formatDateTimeLong(route.decidedAt)}
          />
        ) : null}
        {route.rejection ? (
          <>
            <ReadonlyField
              label={t('admin.riderRoutes.field.rejectionReason')}
              value={t(`domain.routeRejectionReason.${route.rejection.reason}`)}
            />
            <ReadonlyField
              label={t('admin.riderRoutes.field.rejectionComment')}
              value={route.rejection.comment ?? none()}
              multiline
            />
          </>
        ) : null}
        {route.hiddenAt ? (
          <ReadonlyField
            label={t('admin.riderRoutes.field.hiddenAt')}
            value={formatDateTimeLong(route.hiddenAt)}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Страница заявки райдера (`routes.moderate`, routes-06): состояние заявки, автор — только `Райдер ·id` (без имени,
 * N8), карта, цифры и профиль — общий блок страницы маршрута (`RouteReadyView`), жалобы без автора. Действия по
 * состоянию: одобрить (с правкой города и покрытия), отклонить (справочник + комментарий автору), скрыть / вернуть /
 * отклонить жалобы (`ReasonDialog`). Заявку уже изменили (409, 404 — RC-10) — `ConflictBanner` с перечитыванием.
 */
export function RiderRouteScreen({ routeId }: { routeId: string }) {
  const queryClient = useQueryClient();
  const route = useQuery(riderRouteQuery(routeId));
  // стор скраббинга — на экземпляр страницы (маршрут в `key` маршрута роутера)
  const [scrub] = useState(createScrubStore);
  const [action, setAction] = useState<RiderRouteAction>();
  const [stale, setStale] = useState(false);

  const crumb = (
    <Link className="link" to="/rider-routes">
      {t('admin.riderRoutes.title')}
    </Link>
  );

  if (!route.data) {
    if (route.isError || route.fetchStatus === 'paused') {
      if (isForbidden(route.error)) return <NoAccessScreen />;
      return (
        <>
          <PageHeader crumb={crumb} title={t('admin.riderRoutes.title')} />
          <div className="page-body">
            {httpStatus(route.error) === 404 ? (
              <EmptyState title={t('admin.riderRoutes.notFound')} />
            ) : (
              <ErrorState
                error={route.error}
                offline={route.fetchStatus === 'paused'}
                onRetry={() => void route.refetch()}
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
          <span className="skeleton route-page__map-skeleton" data-testid="skeleton-map" />
        </div>
      </>
    );
  }

  const data = route.data;
  const done = async (saved: RiderRouteModerationDetail) => {
    queryClient.setQueryData(riderRouteQuery(saved.id).queryKey, saved);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: RIDER_ROUTES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
    ]);
  };
  const reload = async () => {
    await route.refetch();
    setStale(false);
  };
  const handlers = {
    route: data,
    onDone: done,
    onStale: () => setStale(true),
    onClose: () => setAction(undefined),
  };
  const reasonAction = action === 'approve' || action === 'reject' ? undefined : action;

  return (
    <>
      <PageHeader
        crumb={crumb}
        title={data.title}
        actions={actionsOf(data).map((value) => (
          <Button key={value} variant={ACTION_VARIANT[value]} onClick={() => setAction(value)}>
            {t(ACTION_LABEL[value])}
          </Button>
        ))}
      />
      <div className="page-body">
        {stale ? (
          <ConflictBanner
            title={t('admin.riderRoutes.conflict')}
            message={t('admin.riderRoutes.conflictMessage')}
            busy={route.isFetching}
            onReload={() => void reload()}
          />
        ) : null}
        <Summary route={data} />
        <RouteReadyView route={data} surfaces={data.surfaces} scrub={scrub} />
        <section className="section" aria-labelledby="rider-route-reports-title">
          <h2 id="rider-route-reports-title" className="section__title t-label">
            {t('admin.riderRoutes.reportsTitle')}
          </h2>
          <DataTable
            caption={t('admin.riderRoutes.reportsTitle')}
            columns={reportColumns}
            query={{
              data: data.reports,
              isError: false,
              error: null,
              refetch: () => route.refetch(),
            }}
            getRowId={(report) => report.id}
            empty={<EmptyState title={t('admin.riderRoutes.noReports')} />}
          />
        </section>
      </div>
      {action === 'approve' ? <ApproveRiderRouteDialog {...handlers} /> : null}
      {action === 'reject' ? <RejectRiderRouteDialog {...handlers} /> : null}
      <ReasonDecisionDialog {...handlers} action={reasonAction} />
    </>
  );
}
