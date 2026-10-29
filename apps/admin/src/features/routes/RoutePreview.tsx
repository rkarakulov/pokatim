import { isNetworkError } from '@pokatim/api-client';
import type { PanelRoute } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { geometryFromLine, type ScrubStore } from '@pokatim/route-view';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { formatKmFromMeters } from '../../format';
import { Banner, Button, LinePreview } from '../../ui';
import { mapStyleUrl } from '../maps/map-style';
import { RouteMap } from '../maps/RouteMap';
import { routeQuery } from './routes-query';

/** Что нужно линии от маршрута (routes-06: и заявке райдера). */
type RouteLineData = Pick<PanelRoute, 'title' | 'distanceM' | 'elevationGainM' | 'isLoop' | 'line'>;

const distanceOf = (route: RouteLineData) =>
  route.distanceM !== null ? formatKmFromMeters(route.distanceM) : '';

/** Длина, набор и «Круговой» под превью. */
function routeMeta(route: RouteLineData): string {
  const parts = [distanceOf(route)];
  if (route.elevationGainM !== null) {
    parts.push(t('admin.races.corridor.elevation', { gain: route.elevationGainM }));
  }
  if (route.isLoop) parts.push(t('admin.races.corridor.loop'));
  return parts.filter(Boolean).join(' · ');
}

/**
 * Линия маршрута на подложке (routes-05, A1, RC-9): с env стиля — карта MapLibre с толстой линией (`RouteMap`), без
 * env или без геометрии — прежнее SVG-превью `LinePreview`. `corridorWidthM` — карта гонки с коридором
 * (panel-race-map): слой коридора на карте и подпись с допуском (в `LinePreview` коридора нет — только в подписи).
 */
export function RouteLine({
  route,
  variant,
  scrub,
  corridorWidthM,
}: {
  route: RouteLineData;
  variant: 'page' | 'compact';
  scrub?: ScrubStore;
  corridorWidthM?: number;
}) {
  const geometry = useMemo(() => geometryFromLine(route.line), [route.line]);
  const styleUrl = mapStyleUrl();
  const names = { title: route.title, distance: distanceOf(route) };
  const race = corridorWidthM !== undefined ? { ...names, width: corridorWidthM } : undefined;
  if (!styleUrl || !geometry) {
    return (
      <LinePreview
        points={route.line}
        label={
          race
            ? t('admin.races.map.lineLabel', race)
            : t('admin.races.corridor.previewLabel', names)
        }
      />
    );
  }
  return (
    <RouteMap
      geometry={geometry}
      styleUrl={styleUrl}
      label={race ? t('admin.races.map.label', race) : t('admin.routes.detail.mapLabel', names)}
      variant={variant}
      {...(scrub ? { scrub } : {})}
      {...(corridorWidthM !== undefined ? { corridorWidthM } : {})}
    />
  );
}

/**
 * Куда ведёт «Открыть маршрут» (RC-8): поле коридора — новая вкладка (форма гонки не теряется), окно публикации на
 * «Маршрутах» — та же вкладка, на самой странице маршрута — без ссылки.
 */
export type RouteOpenLink = 'same-tab' | 'new-tab' | false;

/** «Открыть маршрут» — страница маршрута; `newTab` — в новой вкладке (форма гонки не теряется, RC-8). */
export function OpenRouteLink({ routeId, newTab }: { routeId: string; newTab: boolean }) {
  return (
    <Link
      className="link"
      to="/routes/$routeId"
      params={{ routeId }}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {t('admin.routes.detail.open')}
      {newTab ? <span className="visually-hidden"> {t('admin.routes.detail.newTab')}</span> : null}
    </Link>
  );
}

/**
 * Превью маршрута (поле коридора гонки, окно публикации в каталог): скелетон блока, ошибка с повтором, компактная
 * карта (или линия без env) с длиной и ссылкой «Открыть маршрут» (§7 «Состояния»; routes-05, A1). Скраббинга нет.
 */
export function RoutePreview({
  routeId,
  openLink = 'same-tab',
}: {
  routeId: string;
  openLink?: RouteOpenLink;
}) {
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
      <RouteLine route={route} variant="compact" />
      <p className="corridor-preview__meta t-meta">
        {routeMeta(route)}
        {openLink ? (
          <>
            {' · '}
            <OpenRouteLink routeId={route.id} newTab={openLink === 'new-tab'} />
          </>
        ) : null}
      </p>
    </div>
  );
}
