import { describe, expect, it } from 'vitest';

import { ApiHttpError, createApiClient } from './index.ts';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}

const upload = {
  id: '01890a5d-ac96-774b-bcce-b302099a8057',
  source: 'upload',
  format: 'gpx',
  fileName: 'ride.gpx',
  status: 'queued',
  failure: null,
  createdAt: '2026-10-26T08:00:00.000Z',
  activity: null,
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

describe('api-client: загрузки заездов (Bearer — только явным параметром)', () => {
  it('uploadTrack — POST octet-stream с сырыми байтами, имя кодируется в ?name=', async () => {
    const { calls, api } = client(202, upload);
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(api.uploadTrack('access.jwt.x', bytes, 'утро & вечер.gpx')).resolves.toEqual(
      upload,
    );
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/tracks/uploads?name=%D1%83%D1%82%D1%80%D0%BE+%26+%D0%B2%D0%B5%D1%87%D0%B5%D1%80.gpx',
        method: 'POST',
        authorization: 'Bearer access.jwt.x',
        contentType: 'application/octet-stream',
        body: bytes,
      },
    ]);
  });

  it('uploadTrack без имени — без query; 413 — ApiHttpError с кодом', async () => {
    const { calls, api } = client(413, { code: 'TRACK_TOO_LARGE', message: 'x' });
    const error = await api.uploadTrack('t', new Uint8Array([1])).catch((e: unknown) => e);
    expect(calls[0]?.url).toBe('https://api.test/v1/tracks/uploads');
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).apiError.code).toBe('TRACK_TOO_LARGE');
  });

  it('trackUploadRequest — те же путь и заголовки для платформенной отправки с прогрессом', () => {
    const { api } = client(200);
    expect(api.trackUploadRequest('access.jwt.x', 'a b.fit')).toEqual({
      url: 'https://api.test/v1/tracks/uploads?name=a+b.fit',
      method: 'POST',
      headers: {
        authorization: 'Bearer access.jwt.x',
        'content-type': 'application/octet-stream',
      },
    });
  });

  it('getTrackUpload, listTrackUploads, deleteTrackUpload — пути и Bearer', async () => {
    const one = client(200, upload);
    await one.api.getTrackUpload('t', upload.id);
    expect(one.calls[0]).toMatchObject({
      url: `https://api.test/v1/tracks/uploads/${upload.id}`,
      method: 'GET',
      authorization: 'Bearer t',
    });

    const list = client(200, { items: [upload], nextCursor: 'c2' });
    await expect(list.api.listTrackUploads('t', { limit: 20, cursor: 'c1' })).resolves.toEqual({
      items: [upload],
      nextCursor: 'c2',
    });
    expect(list.calls[0]?.url).toBe('https://api.test/v1/tracks/uploads?limit=20&cursor=c1');

    const removed = client(204);
    await expect(removed.api.deleteTrackUpload('t', upload.id)).resolves.toBeUndefined();
    expect(removed.calls[0]).toMatchObject({
      url: `https://api.test/v1/tracks/uploads/${upload.id}/delete`,
      method: 'POST',
      authorization: 'Bearer t',
    });
  });
});
