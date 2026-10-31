import { describe, expect, it } from 'vitest';

import {
  RiderSocial,
  SetRiderConnectionRequest,
  SocialConnectionRow,
  SocialConnections,
} from './rider-social.schema.ts';

const PUBLIC_ID = 'a'.repeat(43);

const ride = {
  id: '01890a5d-ac96-774b-bcce-b302099a8057',
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

describe('«Свои» на профиле райдера (P3, K6)', () => {
  it('RiderSocial: без going — null; с карточкой райда — RideCard', () => {
    const base = {
      self: false,
      connected: true,
      together: { rideCount: 3, lastRideAt: '2026-10-10T07:00:00Z' },
    };
    expect(RiderSocial.parse(base)).toEqual({ ...base, going: null });
    expect(RiderSocial.parse({ ...base, going: ride }).going).toMatchObject({
      id: ride.id,
      viewer: { role: 'none' },
    });
    expect(
      RiderSocial.safeParse({ ...base, together: { rideCount: 1.5, lastRideAt: null } }).success,
    ).toBe(false);
  });

  it('SetRiderConnectionRequest: только { connected: boolean }', () => {
    expect(SetRiderConnectionRequest.parse({ connected: false })).toEqual({ connected: false });
    expect(SetRiderConnectionRequest.safeParse({}).success).toBe(false);
    expect(SetRiderConnectionRequest.safeParse({ connected: 'yes' }).success).toBe(false);
    expect(SetRiderConnectionRequest.safeParse({ connected: true, extra: 1 }).success).toBe(false);
  });

  it('строка «Свои»: незнакомый источник — unknown; лишние поля (userId) отбрасываются', () => {
    const row = SocialConnectionRow.parse({
      publicId: PUBLIC_ID,
      name: 'Анна К.',
      avatar: null,
      rideCount: 0,
      lastRideAt: null,
      sources: ['manual', 'telepathy'],
      userId: 'x',
    });
    expect(row.sources).toEqual(['manual', 'unknown']);
    expect(row).not.toHaveProperty('userId');
    expect(SocialConnectionRow.safeParse({ ...row, publicId: 'short' }).success).toBe(false);
    expect(SocialConnections.parse({ items: [row], count: 1 })).toEqual({ items: [row], count: 1 });
  });
});
