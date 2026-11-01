import { describe, expect, it } from 'vitest';

import { SOCIAL_HOME_RIDERS_MAX, SocialHome } from './home.schema.ts';

const PUBLIC_ID = 'a'.repeat(43);
const UUID = '01890a5d-ac96-774b-bcce-b302099a8057';
const rider = { name: 'Катя Л.', publicId: PUBLIC_ID, avatar: null };

const ride = {
  id: UUID,
  title: 'Кофе-райд',
  organizerName: null,
  startsAt: '2027-06-14T07:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 5,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  viewer: { role: 'none', canJoin: true, canLeave: false, canManage: false },
};

const route = {
  id: UUID,
  title: 'Вокруг моря',
  distanceM: 42_000,
  elevationGainM: 120,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2027-06-13T07:00:00.000Z',
  author: { kind: 'rider', name: 'Катя Л.' },
};

const result = {
  kind: 'result',
  rider,
  race: { id: UUID, title: 'Гран-при' },
  entryId: UUID,
  place: 2,
  tied: false,
  elapsedSec: 7180,
};

describe('SocialHome (social-p7, K7)', () => {
  it('три вида строк; `deltaSec` по умолчанию null', () => {
    const parsed = SocialHome.parse({
      items: [
        { kind: 'ride', ride, riders: [rider], othersCount: 2 },
        result,
        { kind: 'route', rider, route },
      ],
    });
    expect(parsed.items.map((row) => row.kind)).toEqual(['ride', 'result', 'route']);
    expect(parsed.items[1]).toMatchObject({ kind: 'result', deltaSec: null });
  });

  it('незнакомый `kind` и битая строка отбрасываются, ответ не падает', () => {
    const parsed = SocialHome.parse({
      items: [
        { kind: 'photo', id: UUID },
        { ...result, place: 'x' },
        { ...result, deltaSec: -20 },
      ],
    });
    expect(parsed.items).toEqual([{ ...result, deltaSec: -20 }]);
  });

  it('«свой» — только с publicId; в строке райда — не больше трёх', () => {
    expect(
      SocialHome.parse({ items: [{ ...result, rider: { ...rider, publicId: null } }] }).items,
    ).toEqual([]);
    const riders = Array.from({ length: SOCIAL_HOME_RIDERS_MAX + 1 }, () => rider);
    expect(
      SocialHome.parse({ items: [{ kind: 'ride', ride, riders, othersCount: 0 }] }).items,
    ).toEqual([]);
  });
});
