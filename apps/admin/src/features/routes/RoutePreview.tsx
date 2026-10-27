import { isNetworkError } from '@pokatim/api-client';
import type { PanelRoute } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';

import { formatKmFromMeters } from '../../format';
import { Banner, Button, LinePreview } from '../../ui';
import { routeQuery } from './routes-query';

/** Длина, набор и «Круговой» под превью. */
function routeMeta(route: PanelRoute): string {
  const parts = [route.distanceM !== null ? formatKmFromMeters(route.distanceM) : ''];
  if (route.elevationGainM !== null) {
    parts.push(t('admin.races.corridor.elevation', { gain: route.elevationGainM }));
  }
  if (route.isLoop) parts.push(t('admin.races.corridor.loop'));
  return parts.filter(Boolean).join(' · ');
}

/**
 * Превью маршрута (поле коридора гонки, окно публикации в каталог): скелетон блока, ошибка с повтором, линия с длиной
 * (§7 «Состояния»).
 */
export function RoutePreview({ routeId }: { routeId: string }) {
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
