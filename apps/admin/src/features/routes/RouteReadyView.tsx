import type { PanelRoute, Surface } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { routeDurationMin, routePaceKmh, type ScrubStore } from '@pokatim/route-view';

import { formatKmFromMeters } from '../../format';
import { StatTile } from '../../ui';
import { ElevationProfile } from './ElevationProfile';
import { durationText, metersText, profileSummary } from './route-detail-format';
import { RouteLine } from './RoutePreview';

/** Что нужно блоку от маршрута: маршрут команды (`PanelRoute`) и заявка райдера (routes-06) дают одно и то же. */
export type ReadyRouteData = Pick<
  PanelRoute,
  'title' | 'distanceM' | 'elevationGainM' | 'isLoop' | 'line' | 'elevation'
>;

/**
 * Готовый маршрут (routes-05, вынесено в routes-06): карта со скраббингом, цифры, профиль высоты. Страница маршрута
 * команды и страница заявки райдера показывают один и тот же блок. `surfaces` — для времени в пути: неизвестно —
 * пустой список (как асфальт, RC-11).
 */
export function RouteReadyView({
  route,
  surfaces,
  scrub,
}: {
  route: ReadyRouteData;
  surfaces: readonly Surface[];
  scrub: ScrubStore;
}) {
  const distanceM = route.distanceM ?? 0;
  const pace = routePaceKmh(surfaces);
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
