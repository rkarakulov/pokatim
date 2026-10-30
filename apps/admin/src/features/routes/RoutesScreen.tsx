import type { PanelRouteSummary, RouteStatus } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { formatKmFromMeters } from '../../format';
import { useCan } from '../../session/can';
import { isForbidden } from '../../session/errors';
import { Banner, Button, DataTable, EmptyState, FileButton, PageHeader, StatusTag } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { RouteCatalogDialog, UnpublishRouteDialog } from './RouteCatalogDialog';
import { ROUTE_FILE_ACCEPT, RouteUploadDialog, useRouteUpload } from './route-upload';
import { routesPagesQuery } from './routes-query';

const column = createColumnHelper<PanelRouteSummary>();
const STATUS_TONE: Record<RouteStatus, 'neutral' | 'success' | 'error'> = {
  processing: 'neutral',
  ready: 'success',
  failed: 'error',
};

/** «Минск · асфальт, гравий» — город старта и покрытия опубликованного маршрута; не опубликован — «—». */
export function catalogText(catalog: PanelRouteSummary['catalog']): string {
  if (!catalog) return t('admin.routes.catalog.none');
  const surfaces = catalog.surfaces
    .map((surface) => t(`domain.surface.${surface}`).toLocaleLowerCase('ru'))
    .join(', ');
  return `${t(`domain.city.${catalog.city}`)} · ${surfaces}`;
}

type Action = { kind: 'publish' | 'unpublish'; route: PanelRouteSummary };

/**
 * «Маршруты» (`races.read`, routes-01): маршруты команды с колонкой «В каталоге»; с `races.manage` — «Загрузить
 * маршрут» (GPX, KML, KMZ или TCX; та же загрузка, что в поле коридора гонки, RC-15; сбои опроса и «дольше обычного» —
 * баннер над таблицей) и действия готового маршрута: «Опубликовать в каталоге», «Изменить», «Снять с публикации»
 * (подтверждение). Видимость и готовность проверяет сервер.
 */
export function RoutesScreen() {
  const canManage = useCan('races.manage');
  const pages = useInfiniteQuery(routesPagesQuery);
  const upload = useRouteUpload();
  const [action, setAction] = useState<Action>();
  // обработка загруженного не завершилась за предел ожидания — строка «Обрабатывается» до ручного обновления
  const uploadStuck =
    upload.pollExpired && upload.pending?.status !== 'ready' && upload.pending?.status !== 'failed';
  const query = {
    data: pages.data?.pages.flatMap((page) => page.items),
    isError: pages.isError,
    error: pages.error,
    fetchStatus: pages.fetchStatus,
    refetch: () => pages.refetch(),
  };

  const columns = useMemo(
    () => [
      // routes-05: название — ссылка на страницу маршрута (для всех строк: необработанный — статус, отказ — причина)
      column.accessor('title', {
        header: t('admin.routes.column.title'),
        cell: (info) => (
          <Link className="link" to="/routes/$routeId" params={{ routeId: info.row.original.id }}>
            {info.getValue()}
          </Link>
        ),
        enableSorting: false,
      }),
      column.accessor('distanceM', {
        header: t('admin.routes.column.distance'),
        cell: (info) => {
          const value = info.getValue();
          return value === null ? '—' : formatKmFromMeters(value);
        },
        enableSorting: false,
      }),
      column.accessor('elevationGainM', {
        header: t('admin.routes.column.elevation'),
        cell: (info) => {
          const value = info.getValue();
          return value === null ? '—' : t('admin.routes.elevation', { gain: value });
        },
        enableSorting: false,
      }),
      column.accessor('isLoop', {
        header: t('admin.routes.column.loop'),
        cell: (info) => {
          const value = info.getValue();
          if (value === null) return '—';
          return value ? t('admin.routes.yes') : t('admin.routes.no');
        },
        enableSorting: false,
      }),
      column.accessor('status', {
        header: t('admin.routes.column.status'),
        cell: (info) => {
          const { status, failure } = info.row.original;
          return (
            <>
              <StatusTag tone={STATUS_TONE[status]}>{t(`admin.routes.status.${status}`)}</StatusTag>
              {failure ? (
                <span className="t-meta"> {t(`admin.routes.failure.${failure}`)}</span>
              ) : null}
            </>
          );
        },
        enableSorting: false,
      }),
      column.accessor((route) => route.owner.displayName, {
        id: 'owner',
        header: t('admin.routes.column.owner'),
        enableSorting: false,
      }),
      column.accessor('catalog', {
        header: t('admin.routes.column.catalog'),
        cell: (info) => catalogText(info.getValue()),
        enableSorting: false,
      }),
      column.display({
        id: 'actions',
        header: () => <span className="visually-hidden">{t('admin.routes.column.actions')}</span>,
        cell: (info) => {
          const route = info.row.original;
          if (!canManage || route.status !== 'ready') return null;
          const open = (kind: Action['kind']) => setAction({ kind, route });
          if (!route.catalog) {
            return (
              <span className="table__actions">
                <Button
                  size="sm"
                  aria-label={`${t('admin.routes.catalog.publish')}: ${route.title}`}
                  onClick={() => open('publish')}
                >
                  {t('admin.routes.catalog.publish')}
                </Button>
              </span>
            );
          }
          return (
            <span className="table__actions">
              <Button
                size="sm"
                aria-label={`${t('admin.routes.catalog.edit')}: ${route.title}`}
                onClick={() => open('publish')}
              >
                {t('admin.routes.catalog.edit')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                aria-label={`${t('admin.routes.catalog.unpublish')}: ${route.title}`}
                onClick={() => open('unpublish')}
              >
                {t('admin.routes.catalog.unpublish')}
              </Button>
            </span>
          );
        },
      }),
    ],
    [canManage],
  );

  return (
    <>
      <PageHeader
        title={t('admin.routes.title')}
        actions={
          canManage ? (
            <FileButton
              label={t('admin.routes.upload')}
              variant="primary"
              accept={ROUTE_FILE_ACCEPT}
              onFile={upload.chooseFile}
            />
          ) : null
        }
      />
      <div className="page-body">
        {uploadStuck ? (
          <Banner
            tone="warning"
            title={t('admin.races.corridor.processingLong')}
            actions={
              <Button size="sm" onClick={() => void pages.refetch()}>
                {t('admin.routes.refreshList')}
              </Button>
            }
          />
        ) : upload.pollFailed ? (
          <Banner tone="warning" role="status">
            {t('admin.races.corridor.pollFailed')}
          </Banner>
        ) : null}
        <DataTable
          caption={t('admin.routes.title')}
          columns={columns}
          query={query}
          getRowId={(route) => route.id}
          empty={<EmptyState title={t('admin.routes.empty')} />}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
          footer={
            pages.hasNextPage ? (
              <div className="table__more">
                <Button busy={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                  {t('admin.more')}
                </Button>
              </div>
            ) : null
          }
        />
      </div>
      <RouteUploadDialog upload={upload} />
      {action?.kind === 'publish' ? (
        <RouteCatalogDialog route={action.route} onClose={() => setAction(undefined)} />
      ) : null}
      {action?.kind === 'unpublish' ? (
        <UnpublishRouteDialog route={action.route} onClose={() => setAction(undefined)} />
      ) : null}
    </>
  );
}
