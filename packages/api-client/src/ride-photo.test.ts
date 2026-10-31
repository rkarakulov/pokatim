import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { ApiHttpError, createApiClient } from './index.ts';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}

const TOKEN = 'a'.repeat(43);
const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2027-06-14T07:00:00.000Z';

const ride = {
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
  goingCount: 1,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  description: null,
  version: 0,
  photo: { id: TOKEN },
};
const view = {
  ride,
  viewer: { role: 'organizer', canJoin: false, canLeave: false, canManage: true },
};

function capture(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method,
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      body: init?.body,
    });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('api-client: фото райда (ride-photo)', () => {
  it('uploadRidePhoto — PUT octet-stream с байтами; ответ — RideView с photo', async () => {
    const { calls, fetchImpl } = capture(200, view);
    const api = createApiClient({ baseUrl: 'https://api.test', fetchImpl });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const res = await api.uploadRidePhoto('access.jwt.x', ID, bytes);
    expect(res.ride.photo).toEqual({ id: TOKEN });
    expect(calls).toEqual([
      {
        url: `https://api.test/v1/rides/${ID}/photo`,
        method: 'PUT',
        authorization: 'Bearer access.jwt.x',
        contentType: 'application/octet-stream',
        body: bytes,
      },
    ]);
  });

  it('uploadRidePhoto: 422 IMAGE_INVALID — ApiHttpError с кодом', async () => {
    const { fetchImpl } = capture(422, {
      code: 'IMAGE_INVALID',
      message: 'x',
      details: { reason: 'too_small' },
    });
    const api = createApiClient({ baseUrl: 'https://api.test', fetchImpl });
    const error = await api.uploadRidePhoto('t', ID, new Uint8Array([1])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).apiError.code).toBe('IMAGE_INVALID');
  });

  it('ridePhotoUploadRequest — те же путь и заголовки для платформенной отправки', () => {
    const api = createApiClient({ baseUrl: 'https://api.test', fetchImpl: fetch });
    expect(api.ridePhotoUploadRequest('access.jwt.x', ID)).toEqual({
      url: `https://api.test/v1/rides/${ID}/photo`,
      method: 'PUT',
      headers: {
        authorization: 'Bearer access.jwt.x',
        'content-type': 'application/octet-stream',
      },
    });
  });

  it('deleteRidePhoto — POST …/photo/delete с Bearer; ridePhotoUrl — без запроса', async () => {
    const { calls, fetchImpl } = capture(200, { ...view, ride: { ...ride, photo: null } });
    const api = createApiClient({ baseUrl: 'https://api.test', fetchImpl });
    await expect(api.deleteRidePhoto('access.jwt.x', ID)).resolves.toMatchObject({
      ride: { photo: null },
    });
    expect(calls[0]).toMatchObject({
      url: `https://api.test/v1/rides/${ID}/photo/delete`,
      method: 'POST',
      authorization: 'Bearer access.jwt.x',
    });
    expect(api.ridePhotoUrl(TOKEN)).toBe(`https://api.test/v1/ride-photos/${TOKEN}`);
    expect(calls).toHaveLength(1);
  });
});

describe('createAdminApiClient: фото райда (ride-photo)', () => {
  it('resetRidePhoto — POST photo-reset с телом; ridePhotoUrl — без запроса', async () => {
    const detail = {
      id: ID,
      title: 'Кофе-райд',
      organizerName: null,
      startsAt: AT,
      city: 'minsk',
      place: 'Парк',
      distanceKm: 40,
      paceMinKmh: 22,
      paceMaxKmh: 25,
      limit: null,
      goingCount: 3,
      description: null,
      status: 'published',
      phase: 'upcoming',
      cancelReason: null,
      rescheduledAt: null,
      hiddenAt: null,
      openReportCount: 1,
      lastReportAt: AT,
      version: 0,
      reports: [],
      photo: null,
    };
    const { calls, fetchImpl } = capture(200, detail);
    const api = createAdminApiClient({ baseUrl: '', fetchImpl });
    const body = { photoId: TOKEN, reason: 'Чужое фото' };
    await expect(api.resetRidePhoto(ID, body)).resolves.toMatchObject({ photo: null });
    expect(calls[0]?.url).toBe(`/v1/admin/rides/${ID}/photo-reset`);
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.body))).toEqual(body);
    expect(api.ridePhotoUrl(TOKEN)).toBe(`/v1/ride-photos/${TOKEN}`);
    expect(calls).toHaveLength(1);
  });
});
