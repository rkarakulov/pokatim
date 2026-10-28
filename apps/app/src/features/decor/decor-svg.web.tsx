import type { DecorArt, DecorRole } from './halloween-art';

interface DecorSvgProps {
  art: DecorArt;
  colors: Record<DecorRole, string>;
}

/** Фигура декора на web: inline `<svg>` (без `react-native-svg`), заполняет родителя, скрыта от скринридера. */
export function DecorSvg({ art, colors }: DecorSvgProps) {
  return (
    <svg
      viewBox={art.viewBox}
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}
    >
      {art.shapes.map((shape, index) => (
        <path
          key={index}
          d={shape.d}
          fill={shape.fill ? colors[shape.fill] : 'none'}
          stroke={shape.stroke ? colors[shape.stroke] : undefined}
          strokeWidth={shape.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
