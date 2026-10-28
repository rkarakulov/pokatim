import type { AppTheme } from '@pokatim/design-tokens';

/**
 * Графика хеллоуинского декора (halloween-decor): пути в своих `viewBox`, цвет — роль, не значение. Роли
 * сопоставляются ролям активной темы (`halloweenColors`): декор — слой поверх темы, палитру не меняет.
 */
export type DecorRole = 'ink' | 'pumpkin' | 'stem' | 'face' | 'moon';

export interface DecorShape {
  d: string;
  fill?: DecorRole;
  stroke?: DecorRole;
  strokeWidth?: number;
  opacity?: number;
}

export interface DecorArt {
  /** `minX minY width height` */
  viewBox: string;
  shapes: DecorShape[];
}

/** Цвета ролей из темы: силуэты — основной текст, тыква — акцент, хвостик — успех, лицо — фон, луна — внимание. */
export function halloweenColors(theme: AppTheme): Record<DecorRole, string> {
  return {
    ink: theme.text.primary,
    pumpkin: theme.text.accent,
    stem: theme.status.success,
    face: theme.surface.default,
    moon: theme.status.warning,
  };
}

const r1 = (value: number) => Math.round(value * 10) / 10;

function circle(cx: number, cy: number, r: number): string {
  return ellipse(cx, cy, r, r);
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${r1(cx - rx)} ${r1(cy)}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
}

/** Сторона квадрата паутины; угол крепления — правый верхний `(size, 0)`. */
const WEB_SIZE = 120;
const WEB_SPOKES = [4, 20, 36, 52, 68, 84];
const WEB_RINGS = [24, 46, 68, 90, 110];

/**
 * Паутина в правом верхнем углу: лучи из угла и провисающие к углу нити колец. Детерминирована: SSR и клиент дают
 * один и тот же путь.
 */
export function cobwebPath(size = WEB_SIZE): string {
  const point = (r: number, deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [r1(size - r * Math.cos(rad)), r1(r * Math.sin(rad))];
  };
  const spokes = WEB_SPOKES.map((deg) => {
    const [x, y] = point(size * 0.98, deg);
    return `M${size} 0L${x} ${y}`;
  });
  const rings = WEB_RINGS.map((r) => {
    const [startX, startY] = point(r, WEB_SPOKES[0]!);
    const arcs = WEB_SPOKES.slice(1).map((deg, i) => {
      const [cx, cy] = point(r * 0.84, (deg + WEB_SPOKES[i]!) / 2);
      const [x, y] = point(r, deg);
      return `Q${cx} ${cy} ${x} ${y}`;
    });
    return `M${startX} ${startY}${arcs.join('')}`;
  });
  return [...spokes, ...rings].join('');
}

export const COBWEB: DecorArt = {
  viewBox: `0 0 ${WEB_SIZE} ${WEB_SIZE}`,
  shapes: [{ d: cobwebPath(), stroke: 'ink', strokeWidth: 0.8 }],
};

const SPIDER_LEGS = [
  'M8 12Q3 9 1 4',
  'M8 14Q3 12.5 0 10',
  'M8 16Q3 17 1 21',
  'M8.5 18Q5 21 3 24',
  'M16 12Q21 9 23 4',
  'M16 14Q21 12.5 24 10',
  'M16 16Q21 17 23 21',
  'M15.5 18Q19 21 21 24',
].join('');

/** Паук: тело, голова, восемь лап, глаза цвета фона. */
export const SPIDER: DecorArt = {
  viewBox: '0 0 24 24',
  shapes: [
    { d: SPIDER_LEGS, stroke: 'ink', strokeWidth: 1.2 },
    { d: `${ellipse(12, 15, 4.5, 5.5)}${circle(12, 8.5, 3)}`, fill: 'ink' },
    { d: `${circle(10.8, 8, 0.7)}${circle(13.2, 8, 0.7)}`, fill: 'face' },
  ],
};

/** Ведьма на метле, летит влево. */
export const WITCH: DecorArt = {
  viewBox: '0 -8 64 48',
  shapes: [
    { d: 'M6 30L52 25', stroke: 'ink', strokeWidth: 2 },
    { d: 'M26 20L20 27', stroke: 'ink', strokeWidth: 1.6 },
    {
      d: [
        'M50 22L62 18L63 34L50 29Z',
        'M22 28Q26 14 32 12Q36 16 38 27Q30 31 22 28Z',
        'M34 14Q46 14 50 22Q42 20 37 22Z',
        circle(30, 10, 3.5),
        'M23 8L38 6L38.5 7.5L23.5 9.5Z',
        'M27 7.5L33.5 6.5Q33 0 38 -6Q30 -2 27 7.5Z',
      ].join(''),
      fill: 'ink',
    },
  ],
};

/** Летучая мышь. */
export const BAT: DecorArt = {
  viewBox: '0 0 24 12',
  shapes: [
    {
      d: 'M12 4Q10 2 9 4Q6 1 1 2Q4 4 3 7Q6 6 7 9Q9 7 12 10Q15 7 17 9Q18 6 21 7Q20 4 23 2Q18 1 15 4Q14 2 12 4Z',
      fill: 'ink',
    },
  ],
};

/** Луна. */
export const MOON: DecorArt = {
  viewBox: '0 0 40 40',
  shapes: [{ d: circle(20, 20, 18), fill: 'moon' }],
};

/** Тыква-фонарь: три дольки с тонкой обводкой, хвостик, лицо цвета фона. */
export const PUMPKIN: DecorArt = {
  viewBox: '0 0 40 36',
  shapes: [
    { d: 'M18.5 9Q19 3 23 1L24 3Q21 5 21.5 9Z', fill: 'stem' },
    {
      d: `${ellipse(12, 23, 9, 11)}${ellipse(28, 23, 9, 11)}`,
      fill: 'pumpkin',
      stroke: 'ink',
      strokeWidth: 0.6,
    },
    { d: ellipse(20, 22, 9, 12.5), fill: 'pumpkin', stroke: 'ink', strokeWidth: 0.6 },
    {
      d: [
        'M13 19L17 19L15 15Z',
        'M23 19L27 19L25 15Z',
        'M19 22L21 22L20 20Z',
        'M11 25Q20 33 29 25L26 26L24 24.5L22 26.5L20 25L18 26.5L16 24.5L14 26Z',
      ].join(''),
      fill: 'face',
    },
  ],
};
