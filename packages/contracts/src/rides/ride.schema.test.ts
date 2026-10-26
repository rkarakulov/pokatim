import { describe, expect, it } from 'vitest';

import {
  CancelRideRequest,
  CreateRideForm,
  CreateRideRequest,
  RIDE_CANCEL_REASONS,
  RIDE_PHASES,
  RIDE_STATUSES,
  RIDE_VIEWER_ROLES,
  RideCard,
  RideCities,
  RideDetail,
  RideListQuery,
  RideQuotaDetails,
  RideView,
  UpdateRideRequest,
} from './ride.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

const ride = {
  title: 'Кофе-райд на Минское море',
  organizerName: null,
  startsAt: '2027-06-14T07:00:00Z',
  cityCode: 'minsk',
  place: 'Парк Победы, у входа',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  description: null,
};

const codesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('справочники райдов (только в конец)', () => {
  it('порядок значений зафиксирован', () => {
    expect(RIDE_STATUSES).toEqual(['published', 'cancelled']);
    expect(RIDE_PHASES).toEqual(['upcoming', 'past', 'cancelled']);
    expect(RIDE_CANCEL_REASONS).toEqual([
      'weather',
      'organizer_unavailable',
      'low_turnout',
      'road_conditions',
      'other',
    ]);
    expect(RIDE_VIEWER_ROLES).toEqual(['organizer', 'participant', 'none']);
  });
});

describe('CreateRideRequest', () => {
  it('валидный райд; пустые описание и подпись — null; без лимита — null', () => {
    expect(CreateRideRequest.parse(ride)).toEqual(ride);
    expect(
      CreateRideRequest.parse({ ...ride, description: '  ', organizerName: '', limit: null }),
    ).toMatchObject({ description: null, organizerName: null, limit: null });
    expect(CreateRideRequest.parse({ ...ride, organizerName: '  Катя Л. ' }).organizerName).toBe(
      'Катя Л.',
    );
  });

  it('границы длин: название 3–80, подпись 2–80, место 3–120, описание ≤ 1000', () => {
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, title: 'ab' }))).toEqual(['TOO_SHORT']);
    expect(CreateRideRequest.safeParse({ ...ride, title: 'a'.repeat(80) }).success).toBe(true);
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, title: 'a'.repeat(81) }))).toEqual([
      'TOO_LONG',
    ]);
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, title: ' ' }))).toEqual(['REQUIRED']);
    // подпись — от 2 символов (решение оркестратора: «Ян»)
    expect(CreateRideRequest.parse({ ...ride, organizerName: 'Ян' }).organizerName).toBe('Ян');
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, organizerName: ' Я ' }))).toEqual([
      'TOO_SHORT',
    ]);
    expect(
      codesOf(CreateRideRequest.safeParse({ ...ride, organizerName: 'a'.repeat(81) })),
    ).toEqual(['TOO_LONG']);
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, place: 'a'.repeat(121) }))).toEqual([
      'TOO_LONG',
    ]);
    expect(CreateRideRequest.safeParse({ ...ride, description: 'a'.repeat(1000) }).success).toBe(
      true,
    );
    expect(
      codesOf(CreateRideRequest.safeParse({ ...ride, description: 'a'.repeat(1001) })),
    ).toEqual(['TOO_LONG']);
  });

  it('управляющие символы: в названии, месте и подписи — нет; в описании — только перевод строки', () => {
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, title: 'Райд\nдва' }))).toEqual([
      'INVALID',
    ]);
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, place: 'Парк\tПобеды' }))).toEqual([
      'INVALID',
    ]);
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, organizerName: 'Катя\u0007' }))).toEqual([
      'INVALID',
    ]);
    expect(CreateRideRequest.parse({ ...ride, description: 'раз\nдва' }).description).toBe(
      'раз\nдва',
    );
    expect(codesOf(CreateRideRequest.safeParse({ ...ride, description: 'раз\u0000' }))).toEqual([
      'INVALID',
    ]);
  });

  it('числа: дистанция 5–300, темп 10–45, лимит 2–100 — целые', () => {
    for (const [field, value] of [
      ['distanceKm', 4],
      ['distanceKm', 301],
      ['distanceKm', 42.5],
      ['paceMinKmh', 9],
      ['paceMaxKmh', 46],
      ['limit', 1],
      ['limit', 101],
      ['distanceKm', '42'],
    ] as const) {
      expect(codesOf(CreateRideRequest.safeParse({ ...ride, [field]: value }))).toEqual([
        'INVALID',
      ]);
    }
    expect(
      CreateRideRequest.safeParse({ ...ride, distanceKm: 300, limit: 100, paceMaxKmh: 45 }).success,
    ).toBe(true);
  });

  it('темп «от» больше «до» — RIDE_PACE_ORDER под полем «до»; равные — можно', () => {
    const result = CreateRideRequest.safeParse({ ...ride, paceMinKmh: 25, paceMaxKmh: 24 });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['paceMaxKmh'], message: 'RIDE_PACE_ORDER' }),
    ]);
    expect(CreateRideRequest.safeParse({ ...ride, paceMinKmh: 25, paceMaxKmh: 25 }).success).toBe(
      true,
    );
  });

  it('startsAt — UtcMinute: со смещением, с секундами — INVALID_DATE; город — строгий', () => {
    expect(
      codesOf(CreateRideRequest.safeParse({ ...ride, startsAt: '2027-06-14T10:00:00+03:00' })),
    ).toEqual(['INVALID_DATE']);
    expect(
      codesOf(CreateRideRequest.safeParse({ ...ride, startsAt: '2027-06-14T07:00:30Z' })),
    ).toEqual(['INVALID_DATE']);
    expect(CreateRideRequest.safeParse({ ...ride, cityCode: 'Минск' }).success).toBe(false);
  });

  it('строгий: лишний ключ (организатор, участники, статус) — ошибка; без поля — REQUIRED', () => {
    for (const extra of [{ organizerUserId: ID }, { goingCount: 3 }, { status: 'cancelled' }]) {
      expect(CreateRideRequest.safeParse({ ...ride, ...extra }).success).toBe(false);
    }
    const noTitle: Partial<typeof ride> = { ...ride };
    delete noTitle.title;
    expect(codesOf(CreateRideRequest.safeParse(noTitle))).toEqual(['REQUIRED']);
  });
});

describe('UpdateRideRequest, CancelRideRequest', () => {
  it('правка: часть полей + version; без version — ошибка; темп проверяется, когда есть оба', () => {
    expect(UpdateRideRequest.parse({ version: 2, title: 'Новый райд' })).toEqual({
      version: 2,
      title: 'Новый райд',
    });
    expect(UpdateRideRequest.safeParse({ title: 'Новый райд' }).success).toBe(false);
    expect(UpdateRideRequest.safeParse({ version: 0, paceMinKmh: 40 }).success).toBe(true);
    expect(
      codesOf(UpdateRideRequest.safeParse({ version: 0, paceMinKmh: 40, paceMaxKmh: 30 })),
    ).toEqual(['RIDE_PACE_ORDER']);
    expect(UpdateRideRequest.safeParse({ version: 0, status: 'cancelled' }).success).toBe(false);
  });

  it('отмена: причина из справочника обязательна, свободного текста нет', () => {
    expect(CancelRideRequest.parse({ reason: 'weather' })).toEqual({ reason: 'weather' });
    expect(codesOf(CancelRideRequest.safeParse({}))).toEqual(['REQUIRED']);
    expect(CancelRideRequest.safeParse({ reason: 'дождь' }).success).toBe(false);
    expect(CancelRideRequest.safeParse({ reason: 'other', comment: 'x' }).success).toBe(false);
  });
});

describe('CreateRideForm', () => {
  const form = {
    title: 'Кофе-райд',
    organizerName: '',
    date: '2027-06-14',
    time: '10:00',
    cityCode: 'minsk',
    place: 'Парк Победы',
    distanceKm: '42',
    paceMinKmh: '22',
    paceMaxKmh: '24',
    limit: '',
    description: '',
  };

  it('строки полей → числа; пустой лимит — null; дата и время — отдельно', () => {
    expect(CreateRideForm.parse(form)).toEqual({
      ...form,
      organizerName: null,
      distanceKm: 42,
      paceMinKmh: 22,
      paceMaxKmh: 24,
      limit: null,
      description: null,
    });
    expect(CreateRideForm.parse({ ...form, limit: ' 12 ' }).limit).toBe(12);
  });

  it('пустое число — REQUIRED, буквы — INVALID; время ЧЧ:ММ; темп — RIDE_PACE_ORDER', () => {
    expect(codesOf(CreateRideForm.safeParse({ ...form, distanceKm: '' }))).toEqual(['REQUIRED']);
    expect(codesOf(CreateRideForm.safeParse({ ...form, distanceKm: 'сорок' }))).toEqual([
      'INVALID',
    ]);
    expect(codesOf(CreateRideForm.safeParse({ ...form, time: '25:00' }))).toEqual(['INVALID']);
    expect(codesOf(CreateRideForm.safeParse({ ...form, date: '2027-02-30' }))).toEqual([
      'INVALID_DATE',
    ]);
    expect(
      codesOf(CreateRideForm.safeParse({ ...form, paceMinKmh: '30', paceMaxKmh: '20' })),
    ).toEqual(['RIDE_PACE_ORDER']);
  });
});

describe('ответы (tolerantEnum, без служебных полей)', () => {
  const summary = {
    id: ID,
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
  };
  const viewer = { role: 'none', canJoin: true, canLeave: false, canManage: false };

  it('незнакомые фаза, город, причина, роль — unknown', () => {
    const card = RideCard.parse({
      ...summary,
      phase: 'hidden',
      city: 'atlantis',
      cancelReason: 'aliens',
      viewer: { ...viewer, role: 'moderator' },
    });
    expect(card).toMatchObject({
      phase: 'unknown',
      city: 'unknown',
      cancelReason: 'unknown',
      viewer: { role: 'unknown' },
    });
  });

  it('лишние поля ответа отбрасываются; version — только в карточке организатора', () => {
    const detail = RideDetail.parse({ ...summary, description: null, organizerUserId: ID });
    expect(detail).not.toHaveProperty('organizerUserId');
    const asOrganizer = RideView.parse({
      ride: { ...summary, description: null, version: 3 },
      viewer: { ...viewer, role: 'organizer', canJoin: false, canManage: true },
    });
    expect(asOrganizer.ride).toHaveProperty('version', 3);
    const asGuest = RideView.parse({ ride: { ...summary, description: null }, viewer });
    expect(asGuest.ride).not.toHaveProperty('version');
  });

  it('города: незнакомые коды отбрасываются', () => {
    expect(RideCities.parse({ cities: ['minsk', 'atlantis', 'brest'] })).toEqual({
      cities: ['minsk', 'brest'],
    });
  });

  it('квота: вид и размер', () => {
    expect(RideQuotaDetails.parse({ quota: 'organized', limit: 5 })).toEqual({
      quota: 'organized',
      limit: 5,
    });
  });
});

describe('RideListQuery', () => {
  it('лимит 1–50 (по умолчанию 20), город — строка или массив ≤ 12, строгий', () => {
    expect(RideListQuery.parse({})).toEqual({ limit: 20 });
    expect(RideListQuery.parse({ city: 'minsk', limit: '50' })).toEqual({
      city: ['minsk'],
      limit: 50,
    });
    expect(RideListQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(RideListQuery.safeParse({ city: 'Минск' }).success).toBe(false);
    expect(RideListQuery.safeParse({ city: Array(13).fill('minsk') }).success).toBe(false);
    expect(RideListQuery.safeParse({ from: '2027-01-01' }).success).toBe(false);
  });
});
