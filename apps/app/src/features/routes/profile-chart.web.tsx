import type { CatalogRouteElevation } from '@pokatim/contracts';
import { stroke, type AppTheme } from '@pokatim/design-tokens';

import { profilePoints } from './format';
import { PROFILE_FILL_OPACITY } from './profile-style';

/** Единицы `viewBox` (не px): график растягивается по блоку (`preserveAspectRatio="none"`), линия — `non-scaling-stroke`. */
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 250;

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Площадь профиля на web (routes-03, fix «квадратный и тяжёлый профиль»): inline SVG — плавная линия по всем точкам
 * профиля в приглушённом `map.corridor` толщиной `stroke.input` и светлая заливка под ней (`PROFILE_FILL_OPACITY`).
 * Разметка зависит только от данных — SSR и первый клиентский рендер совпадают. Для скринридера — скрыт
 * (альтернатива — у контейнера `ElevationProfile`).
 */
export function ProfileChart({
  elevation,
  theme,
}: {
  elevation: CatalogRouteElevation;
  theme: AppTheme;
}) {
  const points = profilePoints(elevation.profile, elevation.minM, elevation.maxM);
  if (points.length === 0) return null;
  const xy = points.map(([x, y]) => `${round(x * VIEW_WIDTH)},${round((1 - y) * VIEW_HEIGHT)}`);
  const line = `M${xy.join('L')}`;
  const area = `${line}L${VIEW_WIDTH},${VIEW_HEIGHT}L0,${VIEW_HEIGHT}Z`;
  const color = theme.map.corridor;
  return (
    <svg
      data-testid="elevation-profile-svg"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path d={area} fill={color} fillOpacity={PROFILE_FILL_OPACITY} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={stroke.input}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
