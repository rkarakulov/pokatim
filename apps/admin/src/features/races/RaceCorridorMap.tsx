import type { PanelRace } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { createScrubStore } from '@pokatim/route-view';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';

import { Banner, Button, ErrorState } from '../../ui';
import { RouteReadyView } from '../routes/RouteReadyView';
import { OpenRouteLink } from '../routes/RoutePreview';
import { routeQuery } from '../routes/routes-query';

/**
 * Блок «Карта гонки» под формой гонки с сохранённым коридором (panel-race-map): тот же `RouteReadyView`, что на
 * странице маршрута (routes-05), — карта с коридором ±`widthM`, цифры (время в пути — по покрытиям гонки), профиль
 * высоты со скраббингом (стор — на экземпляр блока; `key` — id маршрута). Данные — `routeQuery` (тот же ключ, что у
 * превью поля и дистанции). Первая загрузка — скелетон карты, ошибка без данных — с повтором, ошибка обновления —
 * баннер над блоком; маршрут не готов — блока нет (сервер принимает в коридор только готовый маршрут).
 */
export function RaceCorridorMap({
  corridor,
  surfaces,
}: {
  corridor: NonNullable<PanelRace['corridor']>;
  surfaces: PanelRace['surfaces'];
}) {
  const titleId = useId();
  const [scrub] = useState(createScrubStore);
  const state = useQuery(routeQuery(corridor.route.id));
  const route = state.data;
  if (route && route.status !== 'ready') return null;

  let content: ReactNode;
  if (route) {
    content = (
      <>
        {state.isError ? (
          <Banner
            tone="error"
            role="alert"
            title={t('admin.races.map.refreshFailed')}
            actions={
              <Button size="sm" onClick={() => void state.refetch()}>
                {t('state.retry')}
              </Button>
            }
          />
        ) : null}
        <RouteReadyView
          route={route}
          surfaces={surfaces}
          scrub={scrub}
          corridorWidthM={corridor.widthM}
          headingLevel={3}
        />
        <p className="t-meta">
          {t('admin.races.corridor.widthHint', { width: corridor.widthM })}
          {' · '}
          <OpenRouteLink routeId={route.id} newTab />
        </p>
      </>
    );
  } else if (state.isError || state.fetchStatus === 'paused') {
    content = (
      <ErrorState
        error={state.error}
        offline={state.fetchStatus === 'paused'}
        onRetry={() => void state.refetch()}
      />
    );
  } else {
    content = (
      <div aria-busy="true">
        <span className="skeleton route-page__map-skeleton" data-testid="skeleton-map" />
      </div>
    );
  }

  return (
    <section className="form-group" aria-labelledby={titleId}>
      <h2 id={titleId} className="form-group__title t-label">
        {t('admin.races.map.title')}
      </h2>
      {content}
    </section>
  );
}
