import type { AppThemeId, LonLat, StoryCardTemplate } from '@pokatim/contracts';
import { appThemes } from '@pokatim/design-tokens';
import { contourPath, sliceLine } from '@pokatim/route-view';
import { boundsOf } from '@pokatim/tracks';
import { describe, expect, it } from 'vitest';

import { storyCardFonts } from './story-card.fonts';
import type { StoryCardInput } from './story-card.inputs';
import { renderStoryCardSvg, storyCardRenderInput } from './story-card.png';
import { type StoryCardNode, storyCardTrackView, storyCardTree } from './story-card.render';

/** Входы карточки по умолчанию (синтетика): своя заявка, финальный протокол, место 3. */
function input(
  overrides: Partial<StoryCardInput> = {},
  facts: Partial<StoryCardInput['facts']> = {},
) {
  return {
    template: 'line',
    themeId: 'classic',
    riderName: null,
    ...overrides,
    facts: {
      entryId: 'entry',
      race: {
        title: 'Минская сотка',
        windowStartsAt: new Date('2026-10-03T21:00:00Z'),
        windowEndsAt: new Date('2026-10-12T20:59:00Z'),
        routeId: null,
      },
      status: 'final',
      elapsedSec: 9_754,
      place: 3,
      tied: false,
      group: 'm_u40',
      attempt: null,
      ...facts,
    },
  } satisfies StoryCardInput;
}

/** Все узлы дерева (в глубину). */
function nodes(root: StoryCardNode): StoryCardNode[] {
  const children = root.props.children;
  const list = (Array.isArray(children) ? children : [children]).filter(
    (child): child is StoryCardNode => typeof child === 'object' && child !== null,
  );
  return [root, ...list.flatMap(nodes)];
}
const texts = (root: StoryCardNode) =>
  nodes(root).flatMap((n) => (typeof n.props.children === 'string' ? [n.props.children] : []));
const polyline = (root: StoryCardNode) => nodes(root).find((n) => n.type === 'polyline');
const polylinePoints = (root: StoryCardNode) =>
  String(polyline(root)!.props.points)
    .split(' ')
    .map((pair) => pair.split(',').map(Number) as [number, number]);

describe('приватность линии (AC6)', () => {
  // подъезд от дома (запад) → ворота старта на позиции 2.5 → отрезок гонки → ворота финиша на 6.5 → домой (восток)
  const HOME: LonLat = [27.3, 53.9];
  const line: LonLat[] = [
    HOME,
    [27.4, 53.9],
    [27.5, 53.9],
    [27.52, 53.91],
    [27.54, 53.93],
    [27.56, 53.92],
    [27.58, 53.9],
    [27.6, 53.9],
    [27.8, 53.95],
  ];
  const START: LonLat = [27.51, 53.905];

  it.each(['line', 'night'] as const)(
    '%s: ломаная — только отрезок между воротами, первая точка — ворота старта',
    (template: StoryCardTemplate) => {
      const segment = sliceLine(line, 2.5, 6.5)!;
      expect(segment[0]![0]).toBeCloseTo(START[0], 9);
      expect(segment[0]![1]).toBeCloseTo(START[1], 9);
      const tree = storyCardTree(storyCardRenderInput(input({ template }), segment));
      const points = polylinePoints(tree);
      // проекция того же отрезка — тот же путь; точек подъезда и обратной дороги в нём нет
      const expected = contourPath(segment, boundsOf(segment)!, storyCardTrackView(template))!;
      expect(points).toEqual(expected.points);
      expect(points).toHaveLength(segment.length);
      // если бы дом попал в ломаную, рамка включала бы его: старт уже не у левого поля
      const whole = contourPath(line, boundsOf(line)!, storyCardTrackView(template))!;
      expect(points[0]).not.toEqual(whole.points[2]);
      const start = nodes(tree).find((n) => n.type === 'circle')!;
      expect([start.props.cx, start.props.cy]).toEqual(points[0]);
    },
  );

  it('без линии — ярус пустой, без ошибки', () => {
    const tree = storyCardTree(storyCardRenderInput(input(), null));
    expect(polyline(tree)).toBeUndefined();
    expect(texts(tree)).toContain('2:42:34');
  });
});

describe('тексты', () => {
  it('имя — только когда есть (согласие проверил порт `RIDER_NAMES`)', () => {
    expect(texts(storyCardTree(storyCardRenderInput(input(), null)))).not.toContain(
      'Анна Ковалёва',
    );
    expect(
      texts(storyCardTree(storyCardRenderInput(input({ riderName: 'Анна Ковалёва' }), null))),
    ).toContain('Анна Ковалёва');
  });

  it('название, окно гонки с годом, время, место, группа, бренд; до финала — «Предварительный»', () => {
    const final = texts(storyCardTree(storyCardRenderInput(input(), null)));
    expect(final).toEqual(
      expect.arrayContaining([
        'Гонка',
        'Минская сотка',
        '4–12 октября 2026',
        '2:42:34',
        '3',
        'Место',
        'Мужчины до 40',
        'Группа',
        'Покатим',
      ]),
    );
    const provisional = texts(
      storyCardTree(
        storyCardRenderInput(input({}, { status: 'provisional', place: 2, tied: true }), null),
      ),
    );
    expect(provisional).toEqual(expect.arrayContaining(['Гонка · Предварительный', '=2']));
  });

  it('без места (финишёр) — только группа', () => {
    const list = texts(
      storyCardTree(storyCardRenderInput(input({}, { place: null, status: 'finisher' }), null)),
    );
    expect(list).not.toContain('Место');
    expect(list).toContain('Группа');
  });

  it('время — ступень кегля по длине строки; название — не больше 3 строк', () => {
    const sizeOf = (elapsedSec: number) => {
      const tree = storyCardTree(storyCardRenderInput(input({}, { elapsedSec }), null));
      const time = nodes(tree).find((n) => /^\d+:\d\d:\d\d$/.test(String(n.props.children)))!;
      return time.props.style!.fontSize;
    };
    expect(sizeOf(9_754)).toBe(216);
    expect(sizeOf(36_061)).toBe(180);
    expect(sizeOf(360_061)).toBe(156);
    const title = nodes(storyCardTree(storyCardRenderInput(input(), null))).find(
      (n) => n.props.children === 'Минская сотка',
    )!;
    expect(title.props.style!.lineClamp).toBe(3);
  });
});

describe('цвета темы (AC4)', () => {
  it.each(['classic', 'chrono', 'typography'] as const)(
    '%s: line — светлая схема, night — тёмная',
    async (themeId: AppThemeId) => {
      const theme = appThemes[themeId];
      const fonts = await storyCardFonts(theme);
      for (const [template, scheme] of [
        ['line', theme.schemes.light],
        ['night', theme.schemes.dark],
      ] as const) {
        const tree = storyCardTree(storyCardRenderInput(input({ template, themeId }), null));
        expect(tree.props.style!.backgroundColor).toBe(scheme.surface.default);
        const svg = await renderStoryCardSvg(
          storyCardRenderInput(input({ template, themeId }), null),
          fonts,
        );
        expect(svg.toLowerCase()).toContain(`fill="${scheme.surface.default.toLowerCase()}"`);
      }
    },
  );

  it('смена темы — другой фон', () => {
    const bg = (themeId: AppThemeId) =>
      storyCardTree(storyCardRenderInput(input({ themeId }), null)).props.style!.backgroundColor;
    expect(bg('classic')).not.toBe(bg('journal'));
  });
});
