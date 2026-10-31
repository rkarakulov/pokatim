import type { LonLat, StoryCardTemplate } from '@pokatim/contracts';
import { storyCard } from '@pokatim/design-tokens';
import { describe, expect, it } from 'vitest';

import { achievementCardRenderInput } from './achievement-card.png';
import { achievementCardTree } from './achievement-card.render';
import { type AchievementCardInput, achievementCardHash } from './achievement-card.inputs';
import { type RideInviteInput, rideInviteHash } from './ride-invite.inputs';
import { rideInviteRenderInput } from './ride-invite.png';
import { rideInviteTree } from './ride-invite.render';
import { type RouteCardInput, routeCardHash } from './route-card.inputs';
import { routeCardRenderInput } from './route-card.png';
import { routeCardTree } from './route-card.render';
import { type StoryCardInput, storyCardHash } from './story-card.inputs';
import { storyCardRenderInput } from './story-card.png';
import { brandRow, type StoryCardNode, storyCardTree } from './story-card.render';

/** Короткая ссылка приглашения на карточках (P6, K9): строка бренда, деревья 4 карточек × 2 шаблона, ключи кэша. */
const ADDRESS = 'pokatim.by/i/K7M2PQX';
const LINE: LonLat[] = [
  [27.5, 53.9],
  [27.6, 53.95],
  [27.7, 53.9],
];

const story = (template: StoryCardTemplate, address: string | null): StoryCardInput => ({
  template,
  themeId: 'classic',
  riderName: null,
  address,
  facts: {
    entryId: 'entry',
    race: {
      title: 'Минская сотка',
      windowStartsAt: new Date('2026-10-03T21:00:00Z'),
      windowEndsAt: new Date('2026-10-12T20:59:00Z'),
      routeId: null,
    },
    status: 'final',
    provisional: false,
    elapsedSec: 9_754,
    place: 3,
    tied: false,
    group: 'm_u40',
    attempt: null,
  },
});
const ride = (template: StoryCardTemplate, address: string | null): RideInviteInput => ({
  template,
  themeId: 'classic',
  address,
  facts: {
    rideId: 'ride',
    title: 'Кофе-райд на Минское море',
    startsAt: new Date('2026-10-04T07:00:00Z'),
    place: 'у Дворца спорта',
    distanceKm: 42,
    paceMinKmh: 22,
    paceMaxKmh: 24,
    routeId: null,
    photoId: null,
  },
});
const route = (template: StoryCardTemplate, address: string | null): RouteCardInput => ({
  template,
  themeId: 'classic',
  address,
  facts: {
    routeId: 'route',
    title: 'Минское кольцо',
    distanceM: 68_400,
    elevationGainM: 620,
    isLoop: true,
    city: 'minsk',
  },
});
const achievement = (
  template: StoryCardTemplate,
  address: string | null,
): AchievementCardInput => ({
  template,
  themeId: 'classic',
  objectTitle: 'Минская сотка',
  riderName: null,
  address,
  facts: {
    code: 'race_win',
    object: { kind: 'race', id: 'race', title: 'Минская сотка' },
    factDate: '2026-10-04',
    level: null,
  },
});

const trees: [string, (template: StoryCardTemplate, address: string | null) => StoryCardNode][] = [
  ['гонка', (t, a) => storyCardTree(storyCardRenderInput(story(t, a), LINE))],
  ['райд', (t, a) => rideInviteTree(rideInviteRenderInput(ride(t, a), LINE))],
  ['маршрут', (t, a) => routeCardTree(routeCardRenderInput(route(t, a), LINE))],
  ['достижение', (t, a) => achievementCardTree(achievementCardRenderInput(achievement(t, a)))],
];

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

describe('brandRow', () => {
  const colors = storyCardRenderInput(story('line', null), null).colors;

  it('без адреса — прежний узел бренда (дерево карточки не меняется)', () => {
    const row = brandRow(storyCard.text.colophon, colors, 'ПОКАТИМ', null);
    expect(row.props.children).toBe('ПОКАТИМ');
    expect(row.props.style).toMatchObject({ fontSize: storyCard.text.colophon.size });
  });

  it('с адресом — бренд слева, адрес справа одной строкой высотой бренда', () => {
    const row = brandRow(storyCard.text.colophon, colors, 'ПОКАТИМ', ADDRESS);
    expect(row.props.style).toMatchObject({
      flexDirection: 'row',
      justifyContent: 'space-between',
    });
    expect(strings(row)).toEqual(['ПОКАТИМ', ADDRESS]);
    const [, address] = row.props.children as StoryCardNode[];
    expect(address?.props.style).toMatchObject({
      fontSize: storyCard.text.address.size,
      lineHeight: `${storyCard.text.colophon.lineHeight}px`,
      whiteSpace: 'nowrap',
    });
  });
});

describe('адрес на карточках: 4 вида × 2 шаблона', () => {
  for (const [name, tree] of trees) {
    it.each(['line', 'night'] as const)(
      `${name}, %s: с адресом — строка есть, без — нет`,
      (template) => {
        expect(strings(tree(template, ADDRESS))).toContain(ADDRESS);
        const without = strings(tree(template, null));
        expect(without.some((value) => value.includes('/i/'))).toBe(false);
        // кроме адреса дерево то же
        expect(strings(tree(template, ADDRESS)).filter((value) => value !== ADDRESS)).toEqual(
          without,
        );
      },
    );
  }
});

describe('ключи кэша меняются от адреса (RC-P6-5)', () => {
  it.each([
    ['гонка', () => [storyCardHash(story('line', null)), storyCardHash(story('line', ADDRESS))]],
    ['райд', () => [rideInviteHash(ride('line', null)), rideInviteHash(ride('line', ADDRESS))]],
    ['маршрут', () => [routeCardHash(route('line', null)), routeCardHash(route('line', ADDRESS))]],
    [
      'достижение',
      () => [
        achievementCardHash(achievement('line', null)),
        achievementCardHash(achievement('line', ADDRESS)),
      ],
    ],
  ])('%s', (_, pair) => {
    const [without, withAddress] = pair();
    expect(withAddress).not.toBe(without);
  });
});
