import { describe, expect, it, vi } from 'vitest';

import { STORY_CARD_POLICY } from './sharing.policy';
import { type StoryCardInput, storyCardHash } from './story-card.inputs';

const base: StoryCardInput = {
  template: 'line',
  themeId: 'classic',
  riderName: null,
  facts: {
    entryId: 'entry',
    race: {
      title: 'Минская сотка',
      windowStartsAt: new Date('2026-10-03T21:00:00Z'),
      windowEndsAt: new Date('2026-10-12T20:59:00Z'),
      routeId: 'route',
    },
    status: 'provisional',
    elapsedSec: 9_754,
    place: 3,
    tied: false,
    group: 'overall',
    attempt: { id: 'attempt', checkRevision: 1, segment: [2.5, 40.25], linePoints: 120 },
  },
};
const withFacts = (facts: Partial<StoryCardInput['facts']>): StoryCardInput => ({
  ...base,
  facts: { ...base.facts, ...facts },
});

describe('storyCardHash — ключ кэша карточки', () => {
  it('стабилен при равных входах (новые объекты)', () => {
    expect(storyCardHash(structuredClone(base))).toBe(storyCardHash(base));
    expect(storyCardHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each<[string, StoryCardInput]>([
    ['тема', { ...base, themeId: 'chrono' }],
    ['шаблон', { ...base, template: 'night' }],
    ['имя', { ...base, riderName: 'Анна' }],
    ['место', withFacts({ place: 2 })],
    ['ничья', withFacts({ tied: true })],
    ['статус', withFacts({ status: 'final' })],
    ['ревизия проверки', withFacts({ attempt: { ...base.facts.attempt!, checkRevision: 2 } })],
    ['разметка', withFacts({ attempt: { ...base.facts.attempt!, segment: [3, 40] } })],
  ])('меняется от: %s', (_, changed) => {
    expect(storyCardHash(changed)).not.toBe(storyCardHash(base));
  });

  it('меняется от версии рендера', () => {
    const before = storyCardHash(base);
    vi.spyOn(STORY_CARD_POLICY, 'renderVersion', 'get').mockReturnValue(2 as 1);
    expect(storyCardHash(base)).not.toBe(before);
  });
});
