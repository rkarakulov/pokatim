import type { PanelRoute } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import {
  createScrubStore,
  routeDurationMin,
  routePaceKmh,
  type ScrubStore,
} from '@pokatim/route-view';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';

import { formatKmFromMeters } from '../../format';
import { Can } from '../../session/can';
import { httpStatus, isForbidden } from '../../session/errors';
import { Banner, Button, EmptyState, ErrorState, PageHeader, StatTile, StatusTag } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { ElevationProfile } from './ElevationProfile';
import { RouteCatalogDialog, UnpublishRouteDialog } from './RouteCatalogDialog';
import { durationText, metersText, profileSummary } from './route-detail-format';
import { RouteLine } from './RoutePreview';
import { catalogText } from './RoutesScreen';
import { ROUTE_POLL_MAX_MS, ROUTE_POLL_MS, routeQuery } from './routes-query';

const STATUS_TONE = { processing: 'neutral', ready: 'success', failed: 'error' } as const;
const SKELETON_TILES = 6;

/**
 * Страница маршрута панели `/routes/:id` (`races.read`, routes-05, A1): карта (без env стиля — линия, RC-9), цифры,
 * профиль высоты со скраббингом (маркер на карте ↔ курсор профиля), статус и действия каталога (`races.manage`).
 * Состояния — как у гонки: скелетон под шапкой, 403 — «Нет доступа», 404 — «Маршрут не найден», ошибка — с повтором,
 * ошибка обновления при данных — баннер. Не готов (RC-10): `processing` — опрос `ROUTE_POLL_MS` не дольше
 * `ROUTE_POLL_MAX_MS` (затем «проверьте позже» с «Обновить»), `failed` — причина; карты, цифр и профиля нет.
 */
export function RouteScreen({ routeId }: { routeId: string }) {
  const [pollExpired, setPollExpired] = useState(false);
  const route = useQuery({
    ...routeQuery(routeId),
    refetchInterval: (query) =>
      query.state.data?.status === 'processing' && !pollExpired ? ROUTE_POLL_MS : false,
  });
  const processing = route.data?.status === 'processing';
  // окно опроса — не дольше `ROUTE_POLL_MAX_MS`; «Обновить» сбрасывает `pollExpired` — новое окно со своим таймером
  useEffect(() => {
    if (!processing || pollExpired) return;
    const timer = setTimeout(() => setPollExpired(true), ROUTE_POLL_MAX_MS);
    return () => clearTimeout(timer);
  }, [processing, pollExpired]);

  const crumb = (
    <Link className="link" to="/routes">
      {t('admin.routes.title')}
    </Link>
  );
  if (route.data) {
    return (
      <RouteView
        key={route.data.id}
        route={route.data}
        crumb={crumb}
        refreshFailed={route.isError}
        pollExpired={pollExpired}
        onRefresh={() => {
          setPollExpired(false);
          void route.refetch();
        }}
      />
    );
  }
  if (route.isError || route.fetchStatus === 'paused') {
    if (isForbidden(route.error)) return <NoAccessScreen />;
    return (
      <>
        <PageHeader crumb={crumb} title={t('admin.routes.title')} />
        <div className="page-body">
          {httpStatus(route.error) === 404 ? (
            <EmptyState title={t('admin.routes.detail.notFound')} />
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
      <div className="page-body" aria-busy="true">
        <span className="skeleton route-page__map-skeleton" data-testid="skeleton-map" />
        <div className="stat-tiles route-page__stats">
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <StatTile key={index} label={<span className="skeleton"> </span>} value={undefined} />
          ))}
        </div>
      </div>
    </>
  );
}

type Action = 'publish' | 'unpublish';

function RouteView({
  route,
  crumb,
  refreshFailed,
  pollExpired,
  onRefresh,
}: {
  route: PanelRoute;
  crumb: ReactNode;
  refreshFailed: boolean;
  pollExpired: boolean;
  onRefresh: () => void;
}) {
  // стор скраббинга — на экземпляр страницы (`key` — id маршрута)
  const [scrub] = useState(createScrubStore);
  const [action, setAction] = useState<Action>();
  const ready = route.status === 'ready';

  const actions =
    ready && route.catalog === null ? (
      <Button variant="primary" onClick={() => setAction('publish')}>
        {t('admin.routes.catalog.publish')}
      </Button>
    ) : ready ? (
      <>
        <Button onClick={() => setAction('publish')}>{t('admin.routes.catalog.edit')}</Button>
        <Button variant="danger" onClick={() => setAction('unpublish')}>
          {t('admin.routes.catalog.unpublish')}
        </Button>
      </>
    ) : null;

  return (
    <>
      <PageHeader
        crumb={crumb}
        title={route.title}
        actions={actions ? <Can permission="races.manage">{actions}</Can> : null}
      />
      <div className="page-body">
        {refreshFailed ? (
          <Banner
            tone="error"
            role="alert"
            title={t('state.failedTitle')}
            actions={
              <Button size="sm" onClick={onRefresh}>
                {t('state.retry')}
              </Button>
            }
          />
        ) : null}
        <p className="route-page__status">
          <StatusTag tone={STATUS_TONE[route.status]}>
            {t(`admin.routes.status.${route.status}`)}
          </StatusTag>
          <span className="t-meta">
            {' '}
            {t('admin.routes.column.catalog')}: {catalogText(route.catalog)} ·{' '}
            {t('admin.routes.column.owner')}: {route.owner.displayName}
          </span>
        </p>
        {route.status === 'processing' ? (
          pollExpired ? (
            <Banner
              tone="warning"
              title={t('admin.routes.detail.processingLong')}
              actions={
                <Button size="sm" onClick={onRefresh}>
                  {t('admin.routes.detail.refresh')}
                </Button>
              }
            />
          ) : (
            <p className="t-body" role="status">
              {t('admin.routes.detail.processing')}
            </p>
          )
        ) : null}
        {route.status === 'failed' ? (
          <Banner tone="error" title={t('admin.routes.detail.failed')}>
            {route.failure ? t(`admin.routes.failure.${route.failure}`) : null}
          </Banner>
        ) : null}
        {ready ? <ReadyRoute route={route} scrub={scrub} /> : null}
      </div>
      {action === 'publish' ? (
        <RouteCatalogDialog route={route} openLink={false} onClose={() => setAction(undefined)} />
      ) : null}
      {action === 'unpublish' ? (
        <UnpublishRouteDialog route={route} onClose={() => setAction(undefined)} />
      ) : null}
    </>
  );
}

/** Готовый маршрут: карта со скраббингом, цифры, профиль высоты. */
function ReadyRoute({ route, scrub }: { route: PanelRoute; scrub: ScrubStore }) {
  const distanceM = route.distanceM ?? 0;
  // покрытие известно только у опубликованного; иначе — как асфальт (RC-11)
  const pace = routePaceKmh(route.catalog?.surfaces ?? []);
  const elevation = route.elevation;
  return (
    <>
      <section className="section" aria-labelledby="route-map-title">
        <h2 id="route-map-title" className="section__title t-label">
          {t('admin.routes.detail.map')}
        </h2>
        <RouteLine route={route} variant="page" scrub={scrub} />
      </section>
      <section className="section" aria-labelledby="route-stats-title">
        <h2 id="route-stats-title" className="section__title t-label">
          {t('admin.routes.detail.stats')}
        </h2>
        <div className="stat-tiles">
          <StatTile
            label={t('admin.routes.detail.stats.distance')}
            value={formatKmFromMeters(distanceM)}
          />
          <StatTile
            label={t('admin.routes.detail.stats.gain')}
            value={route.elevationGainM === null ? '—' : metersText(route.elevationGainM)}
          />
          <StatTile
            label={t('admin.routes.detail.stats.max')}
            value={elevation ? metersText(elevation.maxM) : '—'}
          />
          <StatTile
            label={t('admin.routes.detail.stats.min')}
            value={elevation ? metersText(elevation.minM) : '—'}
          />
          <StatTile
            label={t('admin.routes.detail.stats.shape')}
            value={t(route.isLoop ? 'routes.detail.chip.loop' : 'routes.detail.chip.oneWay')}
          />
          <StatTile
            label={t('admin.routes.detail.stats.time')}
            value={durationText(routeDurationMin(distanceM, pace))}
            hint={t('routes.detail.stats.pace', { pace })}
          />
        </div>
      </section>
      <section className="section" aria-labelledby="route-profile-title">
        <h2 id="route-profile-title" className="section__title t-label">
          {t('admin.routes.detail.profile')}
        </h2>
        {elevation ? (
          <ElevationProfile
            elevation={elevation}
            distanceM={distanceM}
            gainM={route.elevationGainM}
            scrub={scrub}
            label={profileSummary(elevation, route.elevationGainM)}
          />
        ) : (
          <p className="muted t-meta">{t('admin.routes.detail.noElevation')}</p>
        )}
      </section>
    </>
  );
}
