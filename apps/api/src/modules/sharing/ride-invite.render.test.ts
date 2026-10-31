import { createHash } from 'node:crypto';

import type { LonLat } from '@pokatim/contracts';
import { appThemes } from '@pokatim/design-tokens';
import { describe, expect, it } from 'vitest';

import { type RideInviteInput, rideInviteHash } from './ride-invite.inputs';
import { renderRideInviteSvg, rideInviteRenderInput } from './ride-invite.png';
import { rideInviteTree } from './ride-invite.render';
import { rideInviteTexts } from './ride-invite.texts';
import { storyCardFonts } from './story-card.fonts';
import type { StoryCardNode } from './story-card.render';

/** Входы приглашения по умолчанию (синтетика): воскресенье 4 октября, 10:00 по Минску. */
function input(
  overrides: Partial<RideInviteInput> = {},
  facts: Partial<RideInviteInput['facts']> = {},
): RideInviteInput {
  return {
    template: 'line',
    themeId: 'classic',
    ...overrides,
    facts: {
      rideId: 'ride',
      title: 'Кофе-райд на Минское море',
      startsAt: new Date('2026-10-04T07:00:00Z'),
      place: 'у Дворца спорта, пр. Победителей',
      distanceKm: 42,
      paceMinKmh: 22,
      paceMaxKmh: 24,
      routeId: null,
      photoId: null,
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

describe('rideInviteTexts — подписи прототипа 4a/4b по Минску', () => {
  it('метка, дата без года, день недели и время, старт, пара', () => {
    expect(rideInviteTexts(input())).toEqual({
      kicker: 'Кофе-райд',
      title: 'Кофе-райд на Минское море',
      date: '4 октября',
      time: 'Воскресенье, 10:00',
      start: 'Старт: у Дворца спорта, пр. Победителей',
      distance: { value: '42', unit: 'км', label: 'Дистанция' },
      pace: { value: '22–24', unit: 'км/ч', label: 'Темп' },
      brand: 'Покатим',
    });
  });

  it('время без ведущего нуля, полночь Минска — другой день; равный темп — одно число; дробная дистанция', () => {
    const texts = rideInviteTexts(
      input(
        {},
        {
          startsAt: new Date('2026-12-31T21:30:00Z'),
          distanceKm: 42.5,
          paceMinKmh: 25,
          paceMaxKmh: 25,
        },
      ),
    );
    expect(texts.date).toBe('1 января');
    expect(texts.time).toBe('Пятница, 0:30');
    expect(texts.distance.value).toBe('42,5');
    expect(texts.pace.value).toBe('25');
  });
});

describe('rideInviteHash', () => {
  it('стабилен; меняется от шаблона, темы, полей райда и публичного маршрута', () => {
    const base = rideInviteHash(input());
    expect(rideInviteHash(input())).toBe(base);
    const changed = [
      input({ template: 'night' }),
      input({ themeId: 'chrono' }),
      input({}, { title: 'Другой' }),
      input({}, { startsAt: new Date('2026-10-04T08:00:00Z') }),
      input({}, { place: 'Другое место' }),
      input({}, { distanceKm: 43 }),
      input({}, { paceMinKmh: 21 }),
      input({}, { paceMaxKmh: 25 }),
      input({}, { routeId: 'route' }),
    ].map(rideInviteHash);
    expect(new Set([base, ...changed]).size).toBe(changed.length + 1);
  });
});

describe('rideInviteTree — раскладки 4b (`line`) и 4a без фото (`night`)', () => {
  it.each(['line', 'night'] as const)('%s: все подписи, бренд, без организатора', (template) => {
    const render = rideInviteRenderInput(input({ template }), null);
    const all = strings(rideInviteTree(render));
    for (const value of [
      'Кофе-райд',
      'Кофе-райд на Минское море',
      '4 октября',
      'Воскресенье, 10:00',
      'Старт: у Дворца спорта, пр. Победителей',
      '42',
      'км',
      'Дистанция',
      '22–24',
      'км/ч',
      'Темп',
      'Покатим',
    ]) {
      expect(all).toContain(value);
    }
  });

  it.each(['line', 'night'] as const)(
    '%s: без линии — нет svg; с линией — svg с точкой старта',
    (template) => {
      expect(types(rideInviteTree(rideInviteRenderInput(input({ template }), null)))).not.toContain(
        'svg',
      );
      const withLine = types(rideInviteTree(rideInviteRenderInput(input({ template }), LINE)));
      expect(withLine).toEqual(expect.arrayContaining(['svg', 'polyline', 'circle']));
    },
  );

  it('цвета — роли темы: `line` — светлая схема, `night` — тёмная', () => {
    const theme = appThemes.classic;
    const light = rideInviteRenderInput(input({ template: 'line' }), null);
    const dark = rideInviteRenderInput(input({ template: 'night' }), null);
    expect(light.colors.background).toBe(theme.schemes.light.surface.default);
    expect(dark.colors.background).toBe(theme.schemes.dark.surface.default);
  });
});

describe('renderRideInviteSvg — satori со шрифтами темы', () => {
  it.each(['line', 'night'] as const)(
    '%s: SVG 1080×1920, длинное название не ломает раскладку',
    async (template) => {
      const long = input(
        { template },
        {
          title:
            'Очень длинное название кофе-райда через три озера, два леса и обратно к кофейне у моря',
        },
      );
      const svg = await renderRideInviteSvg(
        rideInviteRenderInput(long, LINE),
        await storyCardFonts(appThemes.classic),
      );
      expect(svg).toMatch(/^<svg[^>]+width="1080"[^>]+height="1920"/);
    },
  );
});

describe('rideInviteTree — снимок дерева (вынос общих узлов в story-card.render без смены вывода)', () => {
  // фиксированный вход: дерево обоих шаблонов с линией и без — байт-в-байт прежнее (renderVersion не поднимается)
  it.each([
    ['line', true, '4fdcef5fcc432086f73d783ec9e116f02c023950d42eeef7f6b62d143660b0a8'],
    ['line', false, '20cb2537be53455bc204a8c0a06bc6faf03cb725b069dd45c81b6a931de69dbf'],
    ['night', true, '4e7fd0f723294de79c9bf326797cb3fee0fca8663b1d1f27ccbe65d6c5a177d9'],
    ['night', false, '81314300631e7b8659c548cf3f8f974491a1d9f049f2efa038415daaa7baf9e3'],
  ] as const)('%s, линия: %s', (template, withLine, expected) => {
    const tree = rideInviteTree(rideInviteRenderInput(input({ template }), withLine ? LINE : null));
    expect(createHash('sha256').update(JSON.stringify(tree)).digest('hex')).toBe(expected);
  });
});
