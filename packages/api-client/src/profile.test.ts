import { describe, expect, it } from 'vitest';

import { ApiHttpError, createApiClient } from './index.ts';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

/** fetch-заглушка: запоминает метод, путь, заголовок `authorization` и тело. */
function client(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
}

describe('api-client: онбординг профиля (Bearer — только явным параметром)', () => {
  it('getOnboardingStatus — GET с Bearer, ответ по схеме', async () => {
    const { calls, api } = client(200, { surveyCompleted: false });
    await expect(api.getOnboardingStatus('access.jwt.x')).resolves.toEqual({
      surveyCompleted: false,
    });
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/profile/onboarding',
        method: 'GET',
        authorization: 'Bearer access.jwt.x',
        body: undefined,
      },
    ]);
  });

  it('submitOnboardingSurvey — PUT с Bearer и телом', async () => {
    const { calls, api } = client(200, { surveyCompleted: true });
    await expect(
      api.submitOnboardingSurvey('access.jwt.x', { reasons: ['races', 'routes'] }),
    ).resolves.toEqual({ surveyCompleted: true });
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/profile/onboarding/survey',
        method: 'PUT',
        authorization: 'Bearer access.jwt.x',
        body: { reasons: ['races', 'routes'] },
      },
    ]);
  });

  it('ответ не по схеме — ошибка разбора; 401 — ApiHttpError', async () => {
    await expect(
      client(200, { surveyCompleted: 'yes' }).api.getOnboardingStatus('t'),
    ).rejects.toThrow();
    await expect(
      client(401, { code: 'UNAUTHORIZED', message: 'x' }).api.getOnboardingStatus('t'),
    ).rejects.toBeInstanceOf(ApiHttpError);
  });

  it('getProfile — GET /v1/profile с Bearer; неизвестные коды отброшены', async () => {
    const { calls, api } = client(200, { rideReasons: ['calendar', 'future_code'] });
    await expect(api.getProfile('access.jwt.x')).resolves.toMatchObject({
      rideReasons: ['calendar'],
      publicName: null,
      showNameInResults: false,
    });
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/profile',
        method: 'GET',
        authorization: 'Bearer access.jwt.x',
        body: undefined,
      },
    ]);
  });

  it('updateProfile — PATCH /v1/profile с Bearer и телом, ответ — профиль', async () => {
    const view = { rideReasons: ['races'], publicName: 'Анна К.', showNameInResults: true };
    const { calls, api } = client(200, view);
    await expect(
      api.updateProfile('access.jwt.x', { publicName: 'Анна К.', showNameInResults: true }),
    ).resolves.toMatchObject(view);
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/profile',
        method: 'PATCH',
        authorization: 'Bearer access.jwt.x',
        body: { publicName: 'Анна К.', showNameInResults: true },
      },
    ]);
    await expect(
      client(200, { rideReasons: [], showNameInResults: 'yes' }).api.updateProfile('t', {
        showNameInResults: true,
      }),
    ).rejects.toThrow();
  });

  it('публичные методы Bearer не отправляют', async () => {
    const { calls, api } = client(200, { status: 'ok' });
    await api.health().catch(() => undefined);
    await api.refreshSession().catch(() => undefined);
    expect(calls.map((call) => call.authorization)).toEqual([null, null]);
  });
});
