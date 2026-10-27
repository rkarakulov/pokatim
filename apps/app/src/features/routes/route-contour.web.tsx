import { stroke } from '@pokatim/design-tokens';

import {
  CONTOUR_START_RADIUS,
  CONTOUR_VIEW,
  contourPath,
  type RouteContourProps,
} from './route-contour-path';

const VIEW_BOX = `0 0 ${CONTOUR_VIEW.width} ${CONTOUR_VIEW.height}`;

/**
 * Контур маршрута на web (app-themes C2, герой Главной): inline `<svg>` — разметка зависит только от данных, SSR и
 * первый рендер совпадают, `react-native-svg` в web-бандл не попадает. Декоративный: скрыт от скринридера.
 */
export function RouteContour({ geometry, color, startColor }: RouteContourProps) {
  const contour = contourPath(geometry.line, geometry.bounds, CONTOUR_VIEW);
  if (!contour) return null;
  return (
    <svg
      data-testid="route-contour"
      viewBox={VIEW_BOX}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute', inset: 0, display: 'block' }}
    >
      <path
        d={contour.d}
        fill="none"
        stroke={color}
        strokeWidth={stroke.indicator}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={contour.start[0]}
        cy={contour.start[1]}
        r={CONTOUR_START_RADIUS}
        fill={startColor}
      />
    </svg>
  );
}
