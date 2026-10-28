import { describe, expect, it } from 'vitest';

import { isPublicProfile, PROFILE_POLICY } from './profile.policy';

describe('isPublicProfile (profile-moderation)', () => {
  it('публичен — имя строкой и согласие', () => {
    expect(isPublicProfile({ publicName: 'Анна', showNameInResults: true })).toBe(true);
  });

  it.each([
    ['нет согласия', { publicName: 'Анна', showNameInResults: false }],
    ['имя null', { publicName: null, showNameInResults: true }],
    ['нет полей', {}],
    ['нет документа', null],
  ])('%s — не публичен', (_name, doc) => {
    expect(isPublicProfile(doc)).toBe(false);
  });

  it('лимит жалоб — 20 в сутки', () => {
    expect(PROFILE_POLICY.reportLimit).toEqual({ limit: 20, windowSec: 86_400 });
  });
});
