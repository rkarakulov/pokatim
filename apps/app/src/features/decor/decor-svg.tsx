import { StyleSheet, View } from 'react-native';

import { useSvgLib } from '@/features/routes/use-svg-native';

import type { DecorArt, DecorRole } from './halloween-art';

interface DecorSvgProps {
  art: DecorArt;
  colors: Record<DecorRole, string>;
}

/**
 * Фигура декора на native: `react-native-svg` лениво (`useSvgLib`); модуля нет или он грузится — пусто. Заполняет
 * родителя. Web — `decor-svg.web.tsx` (inline `<svg>`).
 */
export function DecorSvg({ art, colors }: DecorSvgProps) {
  const lib = useSvgLib();
  if (!lib) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <lib.Svg viewBox={art.viewBox} width="100%" height="100%">
        {art.shapes.map((shape, index) => (
          <lib.Path
            key={index}
            d={shape.d}
            fill={shape.fill ? colors[shape.fill] : 'none'}
            stroke={shape.stroke ? colors[shape.stroke] : undefined}
            strokeWidth={shape.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </lib.Svg>
    </View>
  );
}
