import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const FILE_ID = 'f'.repeat(43);
const material = {
  id: ID,
  type: 'rules',
  title: 'Положение',
  description: null,
  url: null,
  file: { id: FILE_ID, name: 'rules.pdf', size: 1200 },
};
const adminMaterial = { ...material, version: 1, updatedAt: '2026-10-24T07:00:00.000Z' };

interface Call {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  contentType: string | null;
  authorization: string | null;
  body: unknown;
}

function stub(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method,
      credentials: init?.credentials,
      contentType: headers.get('content-type'),
      authorization: headers.get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(response), { status }),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('api-client: материалы события (event-tickets PR C)', () => {
  it('приложение: публичный список без Authorization, незнакомый тип — unknown; адрес файла', async () => {
    const { calls, fetchImpl } = stub(200, [{ ...material, type: 'future' }]);
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'secret.jwt.x',
      fetchImpl,
    });
    await expect(api.getEventMaterials('race', ID)).resolves.toEqual([
      { ...material, type: 'unknown' },
    ]);
    expect(calls[0]).toMatchObject({
      url: `https://api.test/v1/events/race/${ID}/materials`,
      method: 'GET',
      authorization: null,
    });
    expect(api.eventFileUrl(FILE_ID)).toBe(`https://api.test/v1/event-files/${FILE_ID}`);
  });

  it('панель: список, создание, правка, порядок — с cookie панели', async () => {
    const list = { items: [adminMaterial], itemsLeft: 19, filesLeft: 9 };
    const { calls, fetchImpl } = stub(200, list);
    const api = createAdminApiClient({ baseUrl: '', fetchImpl });
    await expect(api.listEventMaterials('calendar', ID)).resolves.toEqual(list);
    await api.reorderEventMaterials('calendar', ID, { ids: [ID] });
    const one = stub(200, adminMaterial);
    const single = createAdminApiClient({ baseUrl: '', fetchImpl: one.fetchImpl });
    const input = { type: 'link', title: 'Сайт', description: null, url: 'https://a.by' } as const;
    await single.createEventMaterial('race', ID, input);
    await single.updateEventMaterial('race', ID, ID, { title: 'Новое', version: 1 });
    expect(
      [...calls, ...one.calls].map((call) => [call.method, call.url, call.credentials, call.body]),
    ).toEqual([
      ['GET', `/v1/admin/events/calendar/${ID}/materials`, 'same-origin', undefined],
      ['PUT', `/v1/admin/events/calendar/${ID}/materials/order`, 'same-origin', { ids: [ID] }],
      ['POST', `/v1/admin/events/race/${ID}/materials`, 'same-origin', input],
      [
        'PATCH',
        `/v1/admin/events/race/${ID}/materials/${ID}`,
        'same-origin',
        { title: 'Новое', version: 1 },
      ],
    ]);
    expect(single.eventFileUrl(FILE_ID)).toBe(`/v1/event-files/${FILE_ID}`);
  });

  it('панель: загрузка PDF — octet-stream, метаданные в query; удаление — POST …/delete, 204', async () => {
    const upload = stub(201, adminMaterial);
    const api = createAdminApiClient({ baseUrl: '', fetchImpl: upload.fetchImpl });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await expect(
      api.uploadEventMaterial('race', ID, bytes, {
        type: 'rules',
        title: 'Положение гонки',
        fileName: 'rules.pdf',
      }),
    ).resolves.toEqual(adminMaterial);
    expect(upload.calls[0]).toMatchObject({
      method: 'POST',
      url: `/v1/admin/events/race/${ID}/materials/files?type=rules&title=%D0%9F%D0%BE%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5+%D0%B3%D0%BE%D0%BD%D0%BA%D0%B8&fileName=rules.pdf`,
      contentType: 'application/octet-stream',
      credentials: 'same-origin',
      body: bytes,
    });
    const removal = stub(204, undefined);
    await expect(
      createAdminApiClient({ baseUrl: '', fetchImpl: removal.fetchImpl }).deleteEventMaterial(
        'race',
        ID,
        ID,
      ),
    ).resolves.toBeUndefined();
    expect(removal.calls[0]).toMatchObject({
      method: 'POST',
      url: `/v1/admin/events/race/${ID}/materials/${ID}/delete`,
    });
  });
});
