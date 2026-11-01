import type { PanelRoute, Surface } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { routeDurationMin, routePaceKmh, type ScrubStore } from '@pokatim/route-view';
import { useRef } from 'react';

import { formatKmFromMeters } from '../../format';
import { useFullscreen } from '../maps/use-fullscreen';
import { ElevationProfile } from './ElevationProfile';
import { durationText, metersText, profileSummary } from './route-detail-format';
import { RouteLine } from './RoutePreview';
import { RouteStats } from './RouteStats';

/** Что нужно блоку от маршрута: маршрут команды (`PanelRoute`) и заявка райдера (routes-06) дают одно и то же. */
export type ReadyRouteData = Pick<
  PanelRoute,
  'title' | 'distanceM' | 'elevationGainM' | 'isLoop' | 'line' | 'elevation'
>;

/**
 * Готовый маршрут (routes-05, вынесено в routes-06): карта со скраббингом, цифры, профиль высоты. Страница маршрута
 * команды и страница заявки райдера показывают один и тот же блок. `surfaces` — для времени в пути: неизвестно —
 * пустой список (как асфальт, RC-11). Карта гонки (panel-race-map) — тот же блок с коридором `corridorWidthM` и
 * подзаголовками `h3` внутри секции «Карта гонки».
 *
 * Раскладка (admin-maps-desktop, admin-route-stats-compact): блок `.route-view` — карта, цифры строкой (`RouteStats`,
 * заголовок «Цифры» только для скринридера), профиль. На широком экране карта ограничена по высоте, профиль низкий —
 * всё в одном экране, скраббинг по профилю виден на карте (`index.css`). «На весь экран» разворачивает блок целиком:
 * карта занимает остаток, цифры и профиль — снизу.
 */
export function RouteReadyView({
  route,
  surfaces,
  scrub,
  corridorWidthM,
  headingLevel = 2,
}: {
  route: ReadyRouteData;
  surfaces: readonly Surface[];
  scrub: ScrubStore;
  corridorWidthM?: number;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const distanceM = route.distanceM ?? 0;
  const pace = routePaceKmh(surfaces);
  const elevation = route.elevation;
  const block = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(block);
  return (
    <div
      ref={block}
      className={`route-view${fullscreen.active ? ' route-view--fullscreen' : ''}`}
      data-testid="route-view"
    >
      <section className="section route-view__map" aria-labelledby="route-map-title">
        <Heading id="route-map-title" className="section__title t-label">
          {t('admin.routes.detail.map')}
        </Heading>
        <RouteLine
          route={route}
          variant="page"
          scrub={scrub}
          {...(corridorWidthM !== undefined ? { corridorWidthM } : {})}
          {...(fullscreen.supported
            ? { fullscreen: { active: fullscreen.active, onToggle: fullscreen.toggle } }
            : {})}
        />
      </section>
      <section className="route-view__stats" aria-labelledby="route-stats-title">
        <Heading id="route-stats-title" className="visually-hidden">
          {t('admin.routes.detail.stats')}
        </Heading>
        <RouteStats
          items={[
            {
              label: t('admin.routes.detail.stats.distance'),
              value: formatKmFromMeters(distanceM),
            },
            {
              label: t('admin.routes.detail.stats.gain'),
              value: route.elevationGainM === null ? '—' : metersText(route.elevationGainM),
            },
            {
              label: t('admin.routes.detail.stats.max'),
              value: elevation ? metersText(elevation.maxM) : '—',
            },
            {
              label: t('admin.routes.detail.stats.min'),
              value: elevation ? metersText(elevation.minM) : '—',
            },
            {
              label: t('admin.routes.detail.stats.shape'),
              value: t(route.isLoop ? 'routes.detail.chip.loop' : 'routes.detail.chip.oneWay'),
            },
            {
              label: t('admin.routes.detail.stats.time'),
              value: durationText(routeDurationMin(distanceM, pace)),
              hint: t('routes.detail.stats.pace', { pace }),
            },
          ]}
        />
      </section>
      <section className="section route-view__profile" aria-labelledby="route-profile-title">
        <Heading id="route-profile-title" className="section__title t-label">
          {t('admin.routes.detail.profile')}
        </Heading>
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
    </div>
  );
}
