import { describe, expect, it } from 'vitest';

import {
  activeBlock,
  avatarResetBan,
  isPublicProfile,
  PROFILE_POLICY,
  profileViewOf,
  resetsInWindow,
} from './profile.policy';

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

const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-30T12:00:00.000Z');
const ago = (days: number, ms = 0) => new Date(NOW.getTime() - days * DAY_MS - ms);
const BAN_UNTIL = new Date(NOW.getTime() + 30 * DAY_MS);

describe('запрет загрузки фото (profile-moderation-followups, T-1)', () => {
  it('правило: 3 сброса за 180 дней → 30 дней', () => {
    expect(PROFILE_POLICY.avatarBan).toEqual({ resets: 3, windowDays: 180, banDays: 30 });
  });

  it('2 сброса — запрета нет, история пополняется', () => {
    expect(avatarResetBan({ resets: [ago(10)], blockedUntil: null }, NOW)).toEqual({
      resets: [ago(10), NOW],
      blockedUntil: null,
      imposed: null,
    });
  });

  it('3-й сброс за ≤ 180 дней — запрет до now + 30 дней', () => {
    expect(avatarResetBan({ resets: [ago(180, -1), ago(5)], blockedUntil: null }, NOW)).toEqual({
      resets: [ago(180, -1), ago(5), NOW],
      blockedUntil: BAN_UNTIL,
      imposed: BAN_UNTIL,
    });
  });

  it('3 сброса, первый ровно 180 дней назад (граница окна) — вне окна, запрета нет; обрезка', () => {
    expect(avatarResetBan({ resets: [ago(180), ago(5)], blockedUntil: null }, NOW)).toEqual({
      resets: [ago(5), NOW],
      blockedUntil: null,
      imposed: null,
    });
    expect(
      avatarResetBan({ resets: [ago(200), ago(181)], blockedUntil: null }, NOW).resets,
    ).toEqual([NOW]);
  });

  it('4-й сброс при действующем и при истёкшем запрете — снова now + 30 дней', () => {
    const resets = [ago(20), ago(10), ago(5)];
    const active = new Date(NOW.getTime() + 25 * DAY_MS);
    expect(avatarResetBan({ resets, blockedUntil: active }, NOW)).toMatchObject({
      blockedUntil: BAN_UNTIL,
      imposed: BAN_UNTIL,
    });
    expect(avatarResetBan({ resets, blockedUntil: ago(1) }, NOW)).toMatchObject({
      blockedUntil: BAN_UNTIL,
      imposed: BAN_UNTIL,
    });
  });

  it('сброс ниже порога при прежнем запрете — прежнее значение, не новое', () => {
    const old = new Date(NOW.getTime() + DAY_MS);
    expect(avatarResetBan({ resets: [], blockedUntil: old }, NOW)).toEqual({
      resets: [NOW],
      blockedUntil: old,
      imposed: null,
    });
  });

  it('resetsInWindow и activeBlock', () => {
    expect(resetsInWindow([ago(181), ago(179), ago(1)], NOW)).toEqual([ago(179), ago(1)]);
    expect(resetsInWindow(undefined, NOW)).toEqual([]);
    expect(activeBlock(BAN_UNTIL, NOW)).toEqual(BAN_UNTIL);
    expect(activeBlock(NOW, NOW)).toBeNull();
    expect(activeBlock(null, NOW)).toBeNull();
    expect(activeBlock(undefined, NOW)).toBeNull();
  });

  it('profileViewOf: avatarUploadBlockedUntil — только действующий запрет', () => {
    expect(profileViewOf({ rideReasons: [], avatarBlockedUntil: BAN_UNTIL }, NOW)).toMatchObject({
      avatarUploadBlockedUntil: BAN_UNTIL.toISOString(),
    });
    expect(profileViewOf({ rideReasons: [], avatarBlockedUntil: ago(1) }, NOW)).toMatchObject({
      avatarUploadBlockedUntil: null,
    });
    expect(profileViewOf(null, NOW).avatarUploadBlockedUntil).toBeNull();
  });
});
