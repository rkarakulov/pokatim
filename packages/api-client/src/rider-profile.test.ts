import { describe, expect, it } from 'vitest';

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
const AT = '2026-06-01T08:00:00.000Z';
const profile = {
  rideReasons: [],
  publicName: 'Анна К.',
  showNameInResults: true,
  club: 'Velo',
  avatar: { id: TOKEN },
  publicId: TOKEN,
  themeId: 'classic',
  avatarUploadBlockedUntil: null,
};

function client(status: number, response?: unknown) {
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
    return Promise.resolve(
      new Response(response === undefined ? null : JSON.stringify(response), { status }),
    );
  }) as typeof fetch;
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
}

describe('api-client: аватар профиля (rider-profile)', () => {
  it('uploadAvatar — PUT octet-stream с байтами, обрезка в query', async () => {
    const { calls, api } = client(200, profile);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    await expect(
      api.uploadAvatar('access.jwt.x', bytes, { x: 0.25, y: 0, size: 0.5 }),
    ).resolves.toEqual(profile);
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/profile/avatar?x=0.25&y=0&size=0.5',
        method: 'PUT',
        authorization: 'Bearer access.jwt.x',
        contentType: 'application/octet-stream',
        body: bytes,
      },
    ]);
  });

  it('uploadAvatar без обрезки — без query; 415 — ApiHttpError с кодом', async () => {
    const { calls, api } = client(415, { code: 'AVATAR_FORMAT_UNSUPPORTED', message: 'x' });
    const error = await api.uploadAvatar('t', new Uint8Array([1])).catch((e: unknown) => e);
    expect(calls[0]?.url).toBe('https://api.test/v1/profile/avatar');
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).apiError.code).toBe('AVATAR_FORMAT_UNSUPPORTED');
  });

  it('avatarUploadRequest — те же путь и заголовки для платформенной отправки', () => {
    const { api } = client(200);
    expect(api.avatarUploadRequest('access.jwt.x', { x: 0, y: 0.5, size: 1 })).toEqual({
      url: 'https://api.test/v1/profile/avatar?x=0&y=0.5&size=1',
      method: 'PUT',
      headers: {
        authorization: 'Bearer access.jwt.x',
        'content-type': 'application/octet-stream',
      },
    });
  });

  it('deleteAvatar — POST …/delete с Bearer; avatarUrl — без запроса', async () => {
    const { calls, api } = client(200, { ...profile, avatar: null });
    await expect(api.deleteAvatar('access.jwt.x')).resolves.toMatchObject({ avatar: null });
    expect(calls[0]).toMatchObject({
      url: 'https://api.test/v1/profile/avatar/delete',
      method: 'POST',
      authorization: 'Bearer access.jwt.x',
    });
    expect(api.avatarUrl(TOKEN)).toBe(`https://api.test/v1/avatars/${TOKEN}`);
    expect(calls).toHaveLength(1);
  });

  it('getProfile: ответ старого сервера без клуба, аватара и publicId — дефолты', async () => {
    const { api } = client(200, { rideReasons: [], publicName: null, showNameInResults: false });
    await expect(api.getProfile('t')).resolves.toEqual({
      rideReasons: [],
      publicName: null,
      showNameInResults: false,
      club: null,
      avatar: null,
      publicId: null,
      themeId: 'classic',
      avatarUploadBlockedUntil: null,
    });
  });

  it('updateProfile — PATCH с клубом', async () => {
    const { calls, api } = client(200, profile);
    await api.updateProfile('t', { club: 'Velo' });
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ club: 'Velo' }) });
  });
});

describe('api-client: статистика, истории и публичный профиль (rider-profile)', () => {
  it('getProfileStats, listProfileRaces, listProfileRides — Bearer, query курсора', async () => {
    const stats = client(200, {
      activities: 1,
      distanceM: 1000,
      elevationGainM: 10,
      races: 0,
      podiums: 0,
      bestPlaces: [],
    });
    await stats.api.getProfileStats('t');
    expect(stats.calls[0]).toMatchObject({
      url: 'https://api.test/v1/profile/stats',
      method: 'GET',
      authorization: 'Bearer t',
    });

    const races = client(200, { items: [], nextCursor: null });
    await races.api.listProfileRaces('t', { cursor: 'c1', limit: 5 });
    expect(races.calls[0]).toMatchObject({
      url: 'https://api.test/v1/profile/races?cursor=c1&limit=5',
      authorization: 'Bearer t',
    });

    const rides = client(200, {
      items: [{ id: ID, title: 'Кофе', startsAt: AT, distanceKm: 40, role: 'organizer' }],
      nextCursor: null,
    });
    await expect(rides.api.listProfileRides('t')).resolves.toMatchObject({
      items: [{ role: 'organizer' }],
    });
    expect(rides.calls[0]).toMatchObject({
      url: 'https://api.test/v1/profile/rides',
      authorization: 'Bearer t',
    });
  });

  it('getRider и listRiderRaces — публично, без Bearer; id кодируется', async () => {
    const rider = client(200, {
      publicId: TOKEN,
      name: 'Анна К.',
      club: null,
      avatar: null,
      stats: { races: 0, podiums: 0, bestPlace: null },
    });
    await rider.api.getRider(TOKEN);
    expect(rider.calls[0]).toMatchObject({
      url: `https://api.test/v1/riders/${TOKEN}`,
      method: 'GET',
      authorization: null,
    });
    const races = client(200, { items: [], nextCursor: null });
    await races.api.listRiderRaces('a/b', { limit: 3 });
    expect(races.calls[0]).toMatchObject({
      url: 'https://api.test/v1/riders/a%2Fb/races?limit=3',
      authorization: null,
    });
  });
});

describe('api-client: жалоба на профиль райдера (profile-moderation)', () => {
  it('getRiderViewer — GET …/me с Bearer; id кодируется', async () => {
    const { calls, api } = client(200, { canReport: true, reported: false });
    await expect(api.getRiderViewer('access.jwt.x', 'a/b')).resolves.toEqual({
      canReport: true,
      reported: false,
    });
    expect(calls[0]).toMatchObject({
      url: 'https://api.test/v1/riders/a%2Fb/me',
      method: 'GET',
      authorization: 'Bearer access.jwt.x',
    });
  });

  it('reportRider — POST …/reports с телом; 409 PROFILE_INVALID_STATE — ApiHttpError', async () => {
    const ok = client(200, { canReport: false, reported: true });
    await expect(
      ok.api.reportRider('access.jwt.x', TOKEN, { reason: 'photo', comment: 'x' }),
    ).resolves.toEqual({ canReport: false, reported: true });
    expect(ok.calls[0]).toMatchObject({
      url: `https://api.test/v1/riders/${TOKEN}/reports`,
      method: 'POST',
      authorization: 'Bearer access.jwt.x',
    });
    expect(JSON.parse(ok.calls[0]?.body as string)).toEqual({ reason: 'photo', comment: 'x' });

    const own = client(409, {
      code: 'PROFILE_INVALID_STATE',
      message: 'x',
      details: { reason: 'own_profile' },
    });
    const error = await own.api
      .reportRider('t', TOKEN, { reason: 'spam' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).apiError.code).toBe('PROFILE_INVALID_STATE');
  });
});
