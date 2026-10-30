import type { LonLat } from '@pokatim/contracts';
import { appThemes, storyCard } from '@pokatim/design-tokens';
import { describe, expect, it } from 'vitest';

import { type RouteCardInput, routeCardHash } from './route-card.inputs';
import { renderRouteCardSvg, routeCardRenderInput } from './route-card.png';
import { routeCardTree } from './route-card.render';
import { routeCardTexts } from './route-card.texts';
import { storyCardFonts } from './story-card.fonts';
import { cardTrackView, type StoryCardNode } from './story-card.render';

/** Входы карточки маршрута по умолчанию (синтетика): кольцо Минска с набором. */
function input(
  overrides: Partial<Omit<RouteCardInput, 'facts'>> = {},
  facts: Partial<RouteCardInput['facts']> = {},
): RouteCardInput {
  return {
    template: 'line',
    themeId: 'classic',
    ...overrides,
    facts: {
      routeId: 'route',
      title: 'Минское кольцо',
      distanceM: 68_400,
      elevationGainM: 620.4,
      isLoop: true,
      city: 'minsk',
      ...facts,
    },
  };
}

/** Все строки дерева satori (порядок обхода). */
function strings(node: StoryCardNode | string | null | undefined, into: string[] = []): string[] {
  if (node === null || node === undefined) return into;
  if (typeof node === 'string') {
    into.push(node);
    return into;
  }
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) strings(child, into);
  return into;
}

const types = (node: StoryCardNode, into: string[] = []): string[] => {
  into.push(node.type);
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child && typeof child !== 'string') types(child, into);
  }
  return into;
};

const LINE: LonLat[] = [
  [27.55, 53.9],
  [27.6, 53.95],
  [27.7, 53.97],
  [27.75, 54.0],
];

describe('routeCardTexts — метка, название, «город · форма», пара', () => {
  it('кольцо с набором: дистанция дробью ru, набор — целым', () => {
    expect(routeCardTexts(input())).toEqual({
      kicker: 'Маршрут',
      title: 'Минское кольцо',
      place: 'Минск · Круговой',
      stats: [
        { value: '68,4', unit: 'км', label: 'Дистанция' },
        { value: '620', unit: 'м', label: 'Набор' },
      ],
      brand: 'Покатим',
    });
  });

  it('в одну сторону, без набора — одна цифра; большие числа — с разделителем разрядов ru', () => {
    const texts = routeCardTexts(
      input({}, { isLoop: false, elevationGainM: null, city: 'molodechno', distanceM: 120_000 }),
    );
    expect(texts.place).toBe('Молодечно · В одну сторону');
    expect(texts.stats).toEqual([{ value: '120', unit: 'км', label: 'Дистанция' }]);
    const gain = routeCardTexts(input({}, { elevationGainM: 1_240 })).stats[1]!.value;
    expect(gain.replace(/\s/gu, ' ')).toBe('1 240');
  });
});

describe('routeCardHash', () => {
  it('стабилен; меняется от шаблона, темы и каждого поля маршрута', () => {
    const base = routeCardHash(input());
    expect(routeCardHash(input())).toBe(base);
    const changed = [
      input({ template: 'night' }),
      input({ themeId: 'chrono' }),
      input({}, { routeId: 'other' }),
      input({}, { title: 'Другое' }),
      input({}, { distanceM: 68_401 }),
      input({}, { elevationGainM: 621 }),
      input({}, { elevationGainM: null }),
      input({}, { isLoop: false }),
      input({}, { city: 'brest' }),
    ].map(routeCardHash);
    expect(new Set([base, ...changed]).size).toBe(changed.length + 1);
  });

  it('вид карточки в ключе: тот же вход другого вида не совпадает с приглашением; зрителя во входе нет', () => {
    expect(Object.keys(input()).sort()).toEqual(['facts', 'template', 'themeId']);
    expect(routeCardHash(input())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('routeCardTree — раскладки `line` и `night`', () => {
  it.each(['line', 'night'] as const)(
    '%s: метка, название, место, пара, бренд; без автора и id',
    (template) => {
      const all = strings(routeCardTree(routeCardRenderInput(input({ template }), LINE)));
      for (const value of [
        'Маршрут',
        'Минское кольцо',
        'Минск · Круговой',
        '68,4',
        'км',
        'Дистанция',
        '620',
        'м',
        'Набор',
        'Покатим',
      ]) {
        expect(all).toContain(value);
      }
      expect(all.join('\n')).not.toContain('route');
      expect(all.join('\n')).not.toMatch(/автор/iu);
    },
  );

  it.each(['line', 'night'] as const)('%s: без набора — одна цифра', (template) => {
    const all = strings(
      routeCardTree(routeCardRenderInput(input({ template }, { elevationGainM: null }), LINE)),
    );
    expect(all).toContain('Дистанция');
    expect(all).not.toContain('Набор');
  });

  it.each(['line', 'night'] as const)('%s: линия — svg с точкой старта', (template) => {
    const tree = types(routeCardTree(routeCardRenderInput(input({ template }), LINE)));
    expect(tree).toEqual(expect.arrayContaining(['svg', 'polyline', 'circle']));
  });

  it('цвета — роли темы: `line` — светлая схема, `night` — тёмная', () => {
    const theme = appThemes.classic;
    expect(routeCardRenderInput(input({ template: 'line' }), LINE).colors.background).toBe(
      theme.schemes.light.surface.default,
    );
    expect(routeCardRenderInput(input({ template: 'night' }), LINE).colors.background).toBe(
      theme.schemes.dark.surface.default,
    );
  });
});

describe('cardTrackView — общий viewBox приглашения и маршрута', () => {
  it('`line` — ярус 2 сторис, `night` — плитка приглашения', () => {
    expect(cardTrackView('line')).toEqual({
      width: storyCard.line.tier2Width,
      height: storyCard.line.tier2Height,
      padding: storyCard.line.startDot,
    });
    expect(cardTrackView('night')).toEqual({
      width: storyCard.size.width - 2 * storyCard.insetX,
      height: storyCard.invite.tileHeight,
      padding: storyCard.line.startDot,
    });
  });
});

describe('renderRouteCardSvg — satori со шрифтами темы', () => {
  it.each(['line', 'night'] as const)(
    '%s: SVG 1080×1920, длинное название не ломает раскладку',
    async (template) => {
      const long = input(
        { template },
        {
          title:
            'Большое гравийное кольцо Нарочанского края с подъёмами на Голубые горы и обратно к озеру',
          elevationGainM: null,
        },
      );
      const svg = await renderRouteCardSvg(
        routeCardRenderInput(long, LINE),
        await storyCardFonts(appThemes.classic),
      );
      expect(svg).toMatch(/^<svg[^>]+width="1080"[^>]+height="1920"/);
    },
  );
});
