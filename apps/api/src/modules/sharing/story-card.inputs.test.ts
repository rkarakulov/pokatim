import { describe, expect, it, vi } from 'vitest';

import { STORY_CARD_POLICY } from './sharing.policy';
import type { RiderNameDirectory, RiderThemes } from '../profile';
import type { ResultsForSharing } from '../results';
import { type StoryCardInput, StoryCardInputs, storyCardHash } from './story-card.inputs';

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
    provisional: true,
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
    ['предварительность', withFacts({ provisional: false })],
    ['ревизия проверки', withFacts({ attempt: { ...base.facts.attempt!, checkRevision: 2 } })],
    ['разметка', withFacts({ attempt: { ...base.facts.attempt!, segment: [3, 40] } })],
  ])('меняется от: %s', (_, changed) => {
    expect(storyCardHash(changed)).not.toBe(storyCardHash(base));
  });

  it('меняется от версии рендера', () => {
    const before = storyCardHash(base);
    vi.spyOn(STORY_CARD_POLICY, 'renderVersion', 'get').mockReturnValue(5 as 4);
    expect(storyCardHash(base)).not.toBe(before);
  });
});

describe('StoryCardInputs.resolve — тема владельца заявки (user-theme)', () => {
  const inputs = (themeId: StoryCardInput['themeId']) => {
    const themes = { themeOf: vi.fn().mockResolvedValue(themeId) };
    const results = { storyCardFacts: vi.fn().mockResolvedValue(base.facts) };
    const names = { publicNames: vi.fn().mockResolvedValue(new Map()) };
    const service = new StoryCardInputs(
      results as unknown as ResultsForSharing,
      themes as unknown as RiderThemes,
      names as unknown as RiderNameDirectory,
    );
    return { service, themes };
  };

  it('тема берётся из RIDER_THEMES по userId запроса и входит в ключ', async () => {
    const atlas = inputs('atlas');
    const resolved = await atlas.service.resolve('user-1', 'race-1', 'line');
    expect(atlas.themes.themeOf).toHaveBeenCalledWith('user-1');
    expect(resolved?.input.themeId).toBe('atlas');
    const classic = await inputs('classic').service.resolve('user-1', 'race-1', 'line');
    expect(classic?.hash).toBe(storyCardHash(base));
    expect(resolved?.hash).not.toBe(classic?.hash);
  });
});
