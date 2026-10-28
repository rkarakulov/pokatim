/// <reference types="jest" />
import { notificationTargetPath, pushTargetPath } from './notification-target';

const RACE = '0190a6f4-0000-7000-8000-000000000001';
const RIDE = '0190a6f4-0000-7000-8000-000000000002';
const DISPUTE = '0190a6f4-0000-7000-8000-000000000003';
const ROUTE = '0190a6f4-0000-7000-8000-000000000004';

describe('notificationTargetPath — белый список целей (N10)', () => {
  it.each([
    [{ type: 'race', raceId: RACE }, `/races/${RACE}`],
    [{ type: 'ride', rideId: RIDE }, `/rides/${RIDE}`],
    [
      { type: 'dispute-response', raceId: RACE, disputeId: DISPUTE },
      `/races/dispute-response/${RACE}/${DISPUTE}`,
    ],
    [{ type: 'my-route', routeId: ROUTE }, `/routes/mine/${ROUTE}`],
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
  ])('%s — без перехода', (_case, target) => {
    expect(notificationTargetPath(target)).toBeNull();
  });
});

describe('pushTargetPath — нажатие на push', () => {
  it('цель из белого списка — экран объекта', () => {
    expect(pushTargetPath({ type: 'ride', rideId: RIDE })).toBe(`/rides/${RIDE}`);
  });

  it.each([null, undefined, { type: 'unknown' }, 'pokatim://settings/account/delete'])(
    'нет цели или чужое (%j) — центр уведомлений',
    (target) => {
      expect(pushTargetPath(target)).toBe('/notifications');
    },
  );
});
