import { stroke } from '@pokatim/design-tokens';
import { StyleSheet, View } from 'react-native';

import {
  CONTOUR_START_RADIUS,
  CONTOUR_VIEW,
  contourPath,
  type RouteContourProps,
} from './route-contour-path';
import { useSvgLib } from './use-svg-native';

const VIEW_BOX = `0 0 ${CONTOUR_VIEW.width} ${CONTOUR_VIEW.height}`;

/**
 * Контур маршрута на native (app-themes C2, герой Главной): `react-native-svg` лениво (`useSvgLib`); модуля в сборке
 * нет или он грузится — пусто (панель без контура). Декоративный: скрыт от скринридера, заполняет родителя.
 */
export function RouteContour({ geometry, color, startColor }: RouteContourProps) {
  const lib = useSvgLib();
  const contour = contourPath(geometry.line, geometry.bounds, CONTOUR_VIEW);
  if (!lib || !contour) return null;
  return (
    <View
      testID="route-contour"
      style={StyleSheet.absoluteFill}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <lib.Svg viewBox={VIEW_BOX} preserveAspectRatio="xMidYMid meet" width="100%" height="100%">
        <lib.Path
          d={contour.d}
          fill="none"
          stroke={color}
          strokeWidth={stroke.indicator}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <lib.Circle
          cx={contour.start[0]}
          cy={contour.start[1]}
          r={CONTOUR_START_RADIUS}
          fill={startColor}
        />
      </lib.Svg>
    </View>
  );
}
