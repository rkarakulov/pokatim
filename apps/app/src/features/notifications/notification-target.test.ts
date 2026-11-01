/// <reference types="jest" />
import { ACHIEVEMENT_CODES } from '@pokatim/contracts';

import { loadServiceWorker } from '../../../scripts/service-worker-harness';
import { SW_ACHIEVEMENT_CODES } from '../../../scripts/service-worker';
import { notificationTargetPath, pushTargetPath } from './notification-target';

const RACE = '0190a6f4-0000-7000-8000-000000000001';
const RIDE = '0190a6f4-0000-7000-8000-000000000002';
const DISPUTE = '0190a6f4-0000-7000-8000-000000000003';
const ROUTE = '0190a6f4-0000-7000-8000-000000000004';
const RIDER = 'Ab_-'.repeat(10) + 'xyz';

describe('notificationTargetPath — белый список целей (N10)', () => {
  it.each([
    [{ type: 'race', raceId: RACE }, `/races/${RACE}`],
    [{ type: 'ride', rideId: RIDE }, `/rides/${RIDE}?from=notification`],
    [
      { type: 'dispute-response', raceId: RACE, disputeId: DISPUTE },
      `/races/dispute-response/${RACE}/${DISPUTE}`,
    ],
    [{ type: 'my-route', routeId: ROUTE }, `/routes/mine/${ROUTE}`],
    [{ type: 'ticket', code: '7XK2M9PQRT' }, '/tickets/7XK2M9PQRT'],
    [{ type: 'profile-edit' }, '/settings/profile'],
    [{ type: 'achievement', code: 'race_podium' }, '/achievements/race_podium'],
    [
      { type: 'achievement', code: 'season_champion', seasonId: RACE },
      `/achievements/season_champion?season=${RACE}`,
    ],
    [{ type: 'rider', publicId: RIDER }, `/riders/${RIDER}`],
  ])('%j → %s', (target, path) => {
    expect(notificationTargetPath(target)).toBe(path);
  });

  it.each([
    ['unknown', { type: 'unknown' }],
    ['null', null],
    ['незнакомый тип', { type: 'season', seasonId: RACE }],
    ['не Uuid', { type: 'race', raceId: '../../settings/account/delete' }],
    ['адрес вместо цели', 'https://evil.example/races/1'],
    ['путь строкой', `/races/${RACE}`],
    ['лишний адрес в цели', { type: 'ride', rideId: 'https://evil.example' }],
    ['маршрут не Uuid', { type: 'my-route', routeId: '../publish/x' }],
    ['код билета не канонический', { type: 'ticket', code: '7xk2m-9pqrt' }],
    ['код билета — путь', { type: 'ticket', code: '../../settings' }],
    ['незнакомый код достижения', { type: 'achievement', code: 'future_code' }],
    ['код достижения — путь', { type: 'achievement', code: '../settings' }],
    ['сезон не Uuid', { type: 'achievement', code: 'season_podium', seasonId: '../x' }],
    ['publicId райдера короткий', { type: 'rider', publicId: RIDER.slice(1) }],
    ['publicId райдера — путь', { type: 'rider', publicId: `${RIDER.slice(3)}/..` }],
    ['райдер без publicId', { type: 'rider' }],
  ])('%s — без перехода', (_case, target) => {
    expect(notificationTargetPath(target)).toBeNull();
  });
});

describe('pushTargetPath — нажатие на push', () => {
  it('цель из белого списка — экран объекта', () => {
    expect(pushTargetPath({ type: 'ride', rideId: RIDE })).toBe(`/rides/${RIDE}?from=notification`);
  });

  it.each([null, undefined, { type: 'unknown' }, 'pokatim://settings/account/delete'])(
    'нет цели или чужое (%j) — центр уведомлений',
    (target) => {
      expect(pushTargetPath(target)).toBe('/notifications');
    },
  );
});

describe('паритет с service worker (Web Push, ADR-0022)', () => {
  it.each([
    { type: 'race', raceId: RACE },
    { type: 'ride', rideId: RIDE },
    { type: 'dispute-response', raceId: RACE, disputeId: DISPUTE },
    { type: 'my-route', routeId: ROUTE },
    { type: 'ticket', code: '7XK2M9PQRT' },
    { type: 'ticket', code: '7XK2M9PQRU' },
    { type: 'ticket', code: '../admin/x' },
    { type: 'profile-edit' },
    { type: 'achievement', code: 'races_5' },
    { type: 'achievement', code: 'season_regular', seasonId: RACE },
    { type: 'achievement', code: 'future_code' },
    { type: 'achievement', code: 'season_podium', seasonId: '../x' },
    { type: 'achievement' },
    { type: 'rider', publicId: RIDER },
    { type: 'rider', publicId: RIDER.slice(1) },
    { type: 'rider', publicId: `${RIDER.slice(1)}/` },
    { type: 'rider', publicId: 42 },
    { type: 'race', raceId: '../admin' },
    { type: 'race', raceId: RACE.toUpperCase() },
    { type: 'race', raceId: '00000000-0000-0000-0000-000000000000' },
    { type: 'race', raceId: RACE, extra: 'x' },
    { type: 'ride' },
    { type: 'unknown' },
    null,
  ])('нажатие без окна открывает тот же путь, что push в приложении: %o', async (target) => {
    const sw = loadServiceWorker();
    await sw.click(target);
    expect(sw.opened).toEqual([pushTargetPath(target)]);
  });
});

it('коды достижений service worker — копия каталога контрактов', () => {
  expect(SW_ACHIEVEMENT_CODES).toEqual(ACHIEVEMENT_CODES);
});
