/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError, apiErrorOf } from '@pokatim/api-client';
import { getDocumentAsync } from 'expo-document-picker';

import { pickTrackFile } from './pick-track-file';
import { sendTrackFile, UploadCanceledError } from './send-track-file';
import { trackFileBody } from './upload-track';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const REQUEST = {
  url: 'https://api.example/v1/tracks/uploads?name=ride.gpx',
  method: 'POST' as const,
  headers: { authorization: 'Bearer access', 'content-type': 'application/octet-stream' },
};

const uploaded = {
  id: '0199c000-0000-7000-8000-000000000001',
  source: 'upload',
  format: 'gpx',
  fileName: 'ride.gpx',
  status: 'queued',
  failure: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  activity: null,
};

/** XHR браузера — тест управляет событиями. */
class FakeXhr {
  static last: FakeXhr;
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: Partial<ProgressEvent>) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    FakeXhr.last = this;
  }
  abort() {
    this.onabort?.();
  }
}

const realXhr = window.XMLHttpRequest;
beforeEach(() => {
  window.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
});
afterEach(() => {
  window.XMLHttpRequest = realXhr;
  jest.clearAllMocks();
});

const file = new File(['<gpx/>'], 'ride.gpx', { type: 'application/gpx+xml' });

describe('выбор файла (web)', () => {
  it('фильтр `.fit`/`.gpx`, без base64; результат — сам File', async () => {
    jest.mocked(getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ name: 'ride.gpx', uri: 'blob:x', lastModified: 0, size: file.size, file }],
    });

    const picked = await pickTrackFile();

    expect(getDocumentAsync).toHaveBeenCalledWith({
      type: ['.fit', '.gpx'],
      multiple: false,
      base64: false,
    });
    expect(picked).toEqual({ name: 'ride.gpx', size: file.size, uri: 'blob:x', file });
    expect(picked && (await trackFileBody(picked))).toBe(file);
  });

  it('отмена — null', async () => {
    jest.mocked(getDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
    expect(await pickTrackFile()).toBeNull();
  });
});

describe('отправка файла с прогрессом (web, XHR)', () => {
  it('заголовки запроса, тело — File, прогресс в долях, ответ — TrackUpload', async () => {
    const progress = jest.fn();
    const sending = sendTrackFile(REQUEST, file, {
      onProgress: progress,
      signal: new AbortController().signal,
    });
    const xhr = FakeXhr.last;

    expect(xhr.url).toBe(REQUEST.url);
    expect(xhr.headers).toEqual(REQUEST.headers);
    expect(xhr.body).toBe(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 4 });
    expect(progress).toHaveBeenCalledWith(0.75);

    xhr.status = 202;
    xhr.responseText = JSON.stringify(uploaded);
    xhr.onload?.();
    await expect(sending).resolves.toMatchObject({ id: uploaded.id, status: 'queued' });
  });

  it('ответ 413 — ApiHttpError с кодом контракта', async () => {
    const sending = sendTrackFile(REQUEST, file, {
      onProgress: jest.fn(),
      signal: new AbortController().signal,
    });
    FakeXhr.last.status = 413;
    FakeXhr.last.responseText = JSON.stringify({ code: 'TRACK_TOO_LARGE', message: 'x' });
    FakeXhr.last.onload?.();

    const error = await sending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect(apiErrorOf(error)?.code).toBe('TRACK_TOO_LARGE');
  });

  it('обрыв сети — ApiNetworkError («Нет соединения»)', async () => {
    const sending = sendTrackFile(REQUEST, file, {
      onProgress: jest.fn(),
      signal: new AbortController().signal,
    });
    FakeXhr.last.onerror?.();
    await expect(sending).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it('«Отменить» — запрос прерван, UploadCanceledError', async () => {
    const controller = new AbortController();
    const sending = sendTrackFile(REQUEST, file, {
      onProgress: jest.fn(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(sending).rejects.toBeInstanceOf(UploadCanceledError);
  });
});
