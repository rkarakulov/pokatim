import { describe, expect, it } from 'vitest';

import {
  CancelRideRequest,
  JoinRideRequest,
  CreateRideForm,
  CreateRideRequest,
  RIDE_CANCEL_REASONS,
  RIDE_MAP_MAX_POINTS,
  RIDE_NEAR_RADIUS_KM,
  RIDE_PHASES,
  RIDE_ROUTE_ACCESS,
  RIDE_STATUSES,
  RIDE_VIEWER_ROLES,
  RideCard,
  RideCities,
  ImageInvalidDetails,
  RIDE_PHOTO_MAX_BYTES,
  RIDE_PHOTO_MAX_EDGE_PX,
  RIDE_PHOTO_MIN_SHORT_PX,
  RideDetail,
  RideListQuery,
  RidePhotoId,
  RideMap,
  RideMapQuery,
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
    expect(RIDE_STATUSES).toEqual(['published', 'cancelled', 'hidden']);
    expect(RIDE_PHASES).toEqual(['upcoming', 'past', 'cancelled', 'hidden']);
    expect(RIDE_CANCEL_REASONS).toEqual([
      'weather',
      'organizer_unavailable',
      'low_turnout',
      'road_conditions',
      'other',
    ]);
    expect(RIDE_VIEWER_ROLES).toEqual(['organizer', 'participant', 'none']);
    expect(RIDE_ROUTE_ACCESS).toEqual(['public', 'private']);
  });
});

describe('CreateRideRequest', () => {
  it('валидный райд; пустые описание и подпись — null; без лимита — null', () => {
    expect(CreateRideRequest.parse(ride)).toEqual({ ...ride, routeId: null });
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

describe('маршрут райда (05c)', () => {
  it('создание: без routeId (старая сборка) — null; uuid и null — как есть; не uuid — ошибка поля', () => {
    expect(CreateRideRequest.parse(ride).routeId).toBeNull();
    expect(CreateRideRequest.parse({ ...ride, routeId: ID }).routeId).toBe(ID);
    expect(CreateRideRequest.parse({ ...ride, routeId: null }).routeId).toBeNull();
    const invalid = CreateRideRequest.safeParse({ ...ride, routeId: 'route-1' });
    expect(invalid.error?.issues.map((issue) => issue.path)).toEqual([['routeId']]);
  });

  it('правка: без routeId — поля нет в выходе (маршрут не снимается); null — снять; uuid — сменить', () => {
    const parsed = UpdateRideRequest.parse({ version: 1, title: 'Новый райд' });
    expect(parsed).not.toHaveProperty('routeId');
    expect(parsed.routeId).toBeUndefined();
    expect(UpdateRideRequest.parse({ version: 1, routeId: null }).routeId).toBeNull();
    expect(UpdateRideRequest.parse({ version: 1, routeId: ID }).routeId).toBe(ID);
    expect(UpdateRideRequest.safeParse({ version: 1, routeId: 'x' }).success).toBe(false);
  });

  it('форма: routeId — uuid или null', () => {
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
    expect(CreateRideForm.parse({ ...form, routeId: null }).routeId).toBeNull();
    expect(CreateRideForm.parse({ ...form, routeId: ID }).routeId).toBe(ID);
    expect(CreateRideForm.safeParse({ ...form, routeId: 'x' }).success).toBe(false);
  });
});

describe('UpdateRideRequest, CancelRideRequest', () => {
  it('правка: часть полей + version; без version — ошибка; темп проверяется, когда есть оба', () => {
    expect(UpdateRideRequest.parse({ version: 2, title: 'Новый райд' })).toEqual({
      version: 2,
      title: 'Новый райд',
    });
    expect(UpdateRideRequest.safeParse({ title: 'Новый райд' }).success).toBe(false);
    // очистка необязательных полей — null или пустая строка → null (не пропуск поля)
    expect(
      UpdateRideRequest.parse({ version: 1, organizerName: '', description: null, limit: null }),
    ).toEqual({ version: 1, organizerName: null, description: null, limit: null });
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
    routeId: null,
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
      phase: 'archived',
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

  it('05b: фаза hidden разбирается; зритель без reported/canReport (старый ответ) — false', () => {
    const card = RideCard.parse({ ...summary, phase: 'hidden', viewer });
    expect(card.phase).toBe('hidden');
    expect(card.viewer).toMatchObject({ reported: false, canReport: false });
    const reported = RideView.parse({
      ride: { ...summary, description: null },
      viewer: { ...viewer, reported: true, canReport: false },
    });
    expect(reported.viewer).toMatchObject({ reported: true, canReport: false });
  });

  it('города: незнакомые коды отбрасываются', () => {
    expect(RideCities.parse({ cities: ['minsk', 'atlantis', 'brest'] })).toEqual({
      cities: ['minsk', 'brest'],
    });
  });

  it('05c: старый ответ без route/start — null; незнакомый доступ — unknown; маршрут без геометрии', () => {
    const old = RideCard.parse({ ...summary, viewer });
    expect(old.route).toBeNull();
    expect(old.start).toBeNull();
    const route = { id: ID, title: 'Кольцо', distanceM: 42000, elevationGainM: null };
    const card = RideCard.parse({
      ...summary,
      viewer,
      route: { ...route, access: 'shared', ownerUserId: ID, line: [] },
      start: [27.56, 53.9],
    });
    expect(card.route).toEqual({ ...route, access: 'unknown' });
    expect(card.start).toEqual([27.56, 53.9]);
    const detail = RideDetail.parse({
      ...summary,
      description: null,
      route: { ...route, access: 'private' },
      start: null,
    });
    expect(detail.route?.access).toBe('private');
  });

  it('карта ленты: без withoutStart — 0; точек больше 200 — ошибка', () => {
    const point = {
      id: ID,
      title: 'Кофе-райд',
      startsAt: '2027-06-14T07:00:00Z',
      start: [27.56, 53.9],
      goingCount: 2,
      limit: null,
      full: false,
    };
    expect(RideMap.parse({ items: [point] })).toEqual({ items: [point], withoutStart: 0 });
    expect(RideMap.safeParse({ items: Array(RIDE_MAP_MAX_POINTS + 1).fill(point) }).success).toBe(
      false,
    );
    expect(RideMap.safeParse({ items: [{ ...point, start: [200, 0] }] }).success).toBe(false);
  });

  it('ride-photo: старый ответ без photo — null; лишние поля фото отбрасываются', () => {
    const token = 'Ab0_-'.repeat(8) + 'xyz';
    expect(RideCard.parse({ ...summary, viewer }).photo).toBeNull();
    const card = RideCard.parse({
      ...summary,
      viewer,
      photo: { id: token, organizerUserId: ID, bytesLength: 10 },
    });
    expect(card.photo).toEqual({ id: token });
    expect(RideDetail.parse({ ...summary, description: null, photo: null }).photo).toBeNull();
    expect(RideCard.safeParse({ ...summary, viewer, photo: { id: 'x' } }).success).toBe(false);
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

describe('«Рядом» (05c): near и radiusKm', () => {
  it('near=<lat>,<lon> → [lon, lat], округление до 0,01°; radiusKm 5–100, целое', () => {
    expect(RideListQuery.parse({ near: '53.9,27.56' })).toEqual({ limit: 20, near: [27.56, 53.9] });
    expect(RideListQuery.parse({ near: '53.9049,27.5612', radiusKm: '25' })).toEqual({
      limit: 20,
      near: [27.56, 53.9],
      radiusKm: 25,
    });
    expect(RideListQuery.parse({ near: '-89.996,179.996' }).near).toEqual([180, -90]);
    expect(RIDE_NEAR_RADIUS_KM).toEqual({ min: 5, max: 100, default: 25 });
    for (const radiusKm of ['5', '100']) {
      expect(RideListQuery.safeParse({ near: '53.9,27.56', radiusKm }).success).toBe(true);
    }
  });

  it('невалидные near и radiusKm — ошибка; radiusKm без near — INVALID на radiusKm', () => {
    for (const near of ['91,0', 'abc', '53.9', '53.9,27.56,1', '53.9;27.56', '53.9,181']) {
      const result = RideListQuery.safeParse({ near });
      expect(result.success, near).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['near']);
    }
    for (const radiusKm of ['4', '101', '2.5', 'abc']) {
      expect(RideListQuery.safeParse({ near: '53.9,27.56', radiusKm }).success, radiusKm).toBe(
        false,
      );
    }
    const alone = RideListQuery.safeParse({ radiusKm: '25' });
    expect(alone.error?.issues).toEqual([
      expect.objectContaining({ path: ['radiusKm'], message: 'INVALID' }),
    ]);
  });

  it('карта ленты: город, near, radiusKm; строгий; без курсора и лимита', () => {
    expect(RideMapQuery.parse({})).toEqual({});
    expect(RideMapQuery.parse({ city: 'minsk', near: '53.9,27.56', radiusKm: '10' })).toEqual({
      city: ['minsk'],
      near: [27.56, 53.9],
      radiusKm: 10,
    });
    expect(RideMapQuery.safeParse({ limit: '20' }).success).toBe(false);
    expect(RideMapQuery.safeParse({ cursor: 'c' }).success).toBe(false);
    expect(RideMapQuery.safeParse({ radiusKm: '10' }).success).toBe(false);
  });
});

describe('фото райда (ride-photo)', () => {
  it('пределы: 10 МиБ, 1600 px по длинной стороне, короткая ≥ 400', () => {
    expect(RIDE_PHOTO_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(RIDE_PHOTO_MAX_EDGE_PX).toBe(1600);
    expect(RIDE_PHOTO_MIN_SHORT_PX).toBe(400);
  });

  it('RidePhotoId — непрозрачный токен', () => {
    const token = 'Ab0_-'.repeat(8) + 'xyz';
    expect(RidePhotoId.parse(token)).toBe(token);
    expect(RidePhotoId.safeParse(ID).success).toBe(false);
  });

  it('ImageInvalidDetails: незнакомая причина — unknown', () => {
    expect(ImageInvalidDetails.parse({ reason: 'too_small' })).toEqual({ reason: 'too_small' });
    expect(ImageInvalidDetails.parse({ reason: 'unreadable' })).toEqual({ reason: 'unreadable' });
    expect(ImageInvalidDetails.parse({ reason: 'cursed' })).toEqual({ reason: 'unknown' });
  });
});

describe('JoinRideRequest (K12)', () => {
  it('`{}` и `{ source }` проходят; незнакомый источник и лишний ключ — нет', () => {
    expect(JoinRideRequest.parse({})).toEqual({});
    expect(JoinRideRequest.parse({ source: 'ride_card' })).toEqual({ source: 'ride_card' });
    expect(JoinRideRequest.safeParse({ source: 'feed' }).success).toBe(false);
    expect(JoinRideRequest.safeParse({ source: 'ride_card', extra: 1 }).success).toBe(false);
  });
});
