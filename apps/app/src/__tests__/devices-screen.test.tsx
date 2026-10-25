/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { TRACK_FILE_MAX_BYTES } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { getDocumentAsync } from 'expo-document-picker';
import { openAuthSessionAsync } from 'expo-web-browser';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { liveSession, signInForTest } from './auth-fixtures';
import { deviceList, garmin, upload, uploadPage, wahoo, UPLOAD_ID } from './devices-fixtures';
import { createQueryWrapper } from './query-wrapper';
import DevicesScreen from '../app/settings/devices';

jest.mock('@/lib/api');
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const listDevices = jest.mocked(api.listDevices);
const listUploads = jest.mocked(api.listTrackUploads);
const pick = jest.mocked(getDocumentAsync);

/** «Сейчас»: 25 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-25T12:00:00Z');
const never = () => new Promise<never>(() => undefined);
const UPLOAD_URL = 'https://api.example/v1/tracks/uploads?name=ride.gpx';

/** Отправка файла — XHR (прогресс): тест управляет ответом и событиями сам. */
class FakeXhr {
  static last: FakeXhr | undefined;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
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
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

const realXhr = global.XMLHttpRequest;
const realFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  signInForTest();
  // живой access: без обновления перед запросами
  useSessionStore.setState({ session: liveSession });
  listDevices.mockResolvedValue(deviceList(garmin(), wahoo()));
  listUploads.mockResolvedValue(uploadPage(upload()));
  jest.mocked(api.trackUploadRequest).mockReturnValue({
    url: UPLOAD_URL,
    method: 'POST',
    headers: {
      authorization: `Bearer ${liveSession.accessToken}`,
      'content-type': 'application/octet-stream',
    },
  });
  FakeXhr.last = undefined;
  global.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  // копия файла в кеше приложения читается в Blob (native)
  global.fetch = jest.fn(async () => ({ blob: async () => ({ size: 1024 }) })) as never;
});
afterEach(() => {
  global.XMLHttpRequest = realXhr;
  global.fetch = realFetch;
  jest.clearAllMocks();
  jest.useRealTimers();
});

async function openDevices() {
  return renderRouter(
    { 'settings/devices': DevicesScreen },
    { initialUrl: '/settings/devices', wrapper: createQueryWrapper() },
  );
}

const row = (provider: string) => within(screen.getByTestId(`device-${provider}`));
const picked = (name: string, size: number) =>
  pick.mockResolvedValue({
    canceled: false,
    assets: [{ name, size, uri: `file:///cache/${name}`, lastModified: 0 }],
  });

describe('«Устройства»: состояния (AC12)', () => {
  it('заголовок и шапки разделов сразу, на месте данных — скелетоны', async () => {
    listDevices.mockReturnValue(never());
    listUploads.mockReturnValue(never());
    await openDevices();

    expect(await screen.findByRole('header', { name: 'Устройства' })).toBeOnTheScreen();
    expect(screen.getByText('Часы и велокомпьютеры')).toBeOnTheScreen();
    expect(screen.getByText('Последние заезды')).toBeOnTheScreen();
    expect(screen.getByText('FIT или GPX, до 16 МБ')).toBeOnTheScreen();
    expect(screen.getByText('Новые заезды подтягиваются каждые 15 минут')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка')).toHaveLength(2);
    expect(listDevices).toHaveBeenCalledWith(liveSession.accessToken);
    expect(listUploads).toHaveBeenCalledWith(liveSession.accessToken, { limit: 20 });
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), 'Нет соединения'],
    ['сбой API', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), 'Не удалось загрузить'],
  ])('ошибка без данных (%s) — «%s» с повтором', async (_case, error, title) => {
    listDevices.mockRejectedValueOnce(error);
    await openDevices();

    expect(await screen.findByText(title)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByTestId('device-garmin')).toBeOnTheScreen();
  });

  it('сервер без агрегатора (404) — подсказка вместо провайдеров, загрузка файлом доступна', async () => {
    listDevices.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await openDevices();

    expect(
      await screen.findByText(
        'Подключение устройств временно недоступно. Заезды можно загрузить файлом.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Загрузить файл' })).toBeOnTheScreen();
  });
});

describe('«Устройства»: провайдеры и `issue` (AC12)', () => {
  it('статусы, «Синхронизировано …» по Минску, недоступный провайдер — без «Подключить»', async () => {
    listDevices.mockResolvedValue(
      deviceList(
        garmin({ status: 'active', lastSyncedAt: '2026-10-20T09:30:00Z' }),
        wahoo({ available: false }),
      ),
    );
    await openDevices();

    await screen.findByTestId('device-garmin');
    expect(row('garmin').getByText('Подключено')).toBeOnTheScreen();
    expect(row('garmin').getByText('Синхронизировано 20 октября, 12:30')).toBeOnTheScreen();
    expect(
      row('garmin').getByRole('button', { name: 'Синхронизировать сейчас' }),
    ).toBeOnTheScreen();
    expect(row('garmin').getByRole('button', { name: 'Отключить' })).toBeOnTheScreen();
    expect(row('wahoo').getByText('Не подключено')).toBeOnTheScreen();
    expect(row('wahoo').getByText('Подключение временно недоступно')).toBeOnTheScreen();
    expect(row('wahoo').queryByRole('button', { name: 'Подключить' })).toBeNull();
  });

  it.each([
    ['pending', 'Ожидаем подтверждения'],
    ['disconnecting', 'Отключаем…'],
  ] as const)('статус %s — «%s»', async (status, label) => {
    listDevices.mockResolvedValue(deviceList(garmin({ status })));
    await openDevices();
    expect(await screen.findByText(label)).toBeOnTheScreen();
  });

  it('`reauthorize` — «Нужно подключить снова» и «Подключить снова»', async () => {
    listDevices.mockResolvedValue(deviceList(garmin({ status: 'active', issue: 'reauthorize' })));
    await openDevices();

    await screen.findByTestId('device-garmin');
    expect(row('garmin').getByText('Нужно подключить снова')).toBeOnTheScreen();
    expect(row('garmin').getByRole('button', { name: 'Подключить снова' })).toBeOnTheScreen();
    expect(row('garmin').queryByRole('button', { name: 'Синхронизировать сейчас' })).toBeNull();
  });

  it('`pending` (браузер закрыли / OW увёл на свою ошибку) — «Подключить снова» начинает заново', async () => {
    listDevices.mockResolvedValue(deviceList(garmin({ status: 'pending' })));
    jest
      .mocked(api.connectDevice)
      .mockResolvedValue({ authorizeUrl: 'https://ow.example/authorize' });
    jest
      .mocked(openAuthSessionAsync)
      .mockResolvedValue({ type: 'cancel' } as Awaited<ReturnType<typeof openAuthSessionAsync>>);
    await openDevices();

    await screen.findByTestId('device-garmin');
    expect(row('garmin').getByText('Ожидаем подтверждения')).toBeOnTheScreen();
    expect(row('garmin').queryByRole('button', { name: 'Синхронизировать сейчас' })).toBeNull();
    await fireEvent.press(row('garmin').getByRole('button', { name: 'Подключить снова' }));

    await waitFor(() => expect(openAuthSessionAsync).toHaveBeenCalled());
    expect(api.connectDevice).toHaveBeenCalledWith(
      liveSession.accessToken,
      'garmin',
      expect.objectContaining({ returnUrl: expect.any(String) }),
    );
  });

  it('`sync_failed` — «Не удалось получить заезды» и «Синхронизировать сейчас»', async () => {
    listDevices.mockResolvedValue(deviceList(garmin({ status: 'active', issue: 'sync_failed' })));
    await openDevices();

    await screen.findByTestId('device-garmin');
    expect(row('garmin').getByText('Не удалось получить заезды')).toBeOnTheScreen();
    expect(
      row('garmin').getByRole('button', { name: 'Синхронизировать сейчас' }),
    ).toBeOnTheScreen();
  });

  it('`revoke_failed` — подсказка отозвать доступ в Garmin Connect / приложении Wahoo', async () => {
    listDevices.mockResolvedValue(
      deviceList(
        garmin({ status: 'revoked', issue: 'revoke_failed' }),
        wahoo({ status: 'revoked', issue: 'revoke_failed' }),
      ),
    );
    await openDevices();

    expect(await screen.findByText(/в Garmin Connect\.$/)).toBeOnTheScreen();
    expect(screen.getByText(/в приложении Wahoo\.$/)).toBeOnTheScreen();
  });

  it('«Синхронизировать сейчас»: успех — подсказка; 429 — когда повторить (`retryAfterSec`)', async () => {
    listDevices.mockResolvedValue(deviceList(garmin({ status: 'active' })));
    jest
      .mocked(api.syncDevice)
      .mockRejectedValueOnce(
        new ApiHttpError(429, {
          code: 'RATE_LIMITED',
          message: 'x',
          details: { retryAfterSec: 540 },
        }),
      )
      .mockResolvedValue(deviceList(garmin({ status: 'active' })));
    await openDevices();

    await fireEvent.press(await screen.findByRole('button', { name: 'Синхронизировать сейчас' }));
    expect(
      await screen.findByText('Синхронизация уже запущена. Повторите через 9:00.'),
    ).toBeOnTheScreen();
    expect(api.syncDevice).toHaveBeenCalledWith(liveSession.accessToken, 'garmin');

    await fireEvent.press(screen.getByRole('button', { name: 'Синхронизировать сейчас' }));
    expect(await screen.findByText(/Запросили новые заезды/)).toBeOnTheScreen();
  });

  it('«Отключить» — подтверждение, галочка «Удалить заезды из Garmin» по умолчанию выключена', async () => {
    listDevices.mockResolvedValue(deviceList(garmin({ status: 'active' })));
    jest
      .mocked(api.disconnectDevice)
      .mockResolvedValue(deviceList(garmin({ status: 'disconnecting' })));
    await openDevices();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отключить' }));
    const checkbox = screen.getByRole('checkbox', { name: 'Удалить заезды из Garmin' });
    expect(checkbox).not.toBeChecked();
    expect(api.disconnectDevice).not.toHaveBeenCalled();

    await fireEvent.press(checkbox);
    await fireEvent.press(screen.getByRole('button', { name: 'Отключить' }));

    expect(await screen.findByText('Отключаем…')).toBeOnTheScreen();
    expect(api.disconnectDevice).toHaveBeenCalledWith(liveSession.accessToken, 'garmin', {
      deleteActivities: true,
    });
  });

  it('«Отключить» → «Отмена» — запроса нет', async () => {
    listDevices.mockResolvedValue(deviceList(garmin({ status: 'active' })));
    await openDevices();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отключить' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(api.disconnectDevice).not.toHaveBeenCalled();
  });
});

describe('«Устройства»: последние загрузки (AC12)', () => {
  it('строка: имя файла или источник, старт по Минску и км, статус', async () => {
    listUploads.mockResolvedValue(
      uploadPage(
        upload(),
        upload({
          id: '0199c000-0000-7000-8000-000000000002',
          source: 'garmin',
          fileName: null,
          status: 'duplicate',
        }),
        upload({
          id: '0199c000-0000-7000-8000-000000000003',
          status: 'failed',
          failure: 'no_timestamps',
          activity: null,
        }),
        upload({
          id: '0199c000-0000-7000-8000-000000000004',
          status: 'failed',
          failure: 'timeout',
          activity: null,
        }),
      ),
    );
    await openDevices();

    const first = within(await screen.findByTestId(`upload-${UPLOAD_ID}`));
    expect(first.getByText('ride.gpx')).toBeOnTheScreen();
    expect(first.getByText('20 октября, 09:30 · 42,2 км')).toBeOnTheScreen();
    expect(first.getByText('Готово')).toBeOnTheScreen();
    const fromGarmin = within(screen.getByTestId('upload-0199c000-0000-7000-8000-000000000002'));
    expect(fromGarmin.getByText('Garmin')).toBeOnTheScreen();
    expect(fromGarmin.getByText('Такой заезд уже есть')).toBeOnTheScreen();
    expect(screen.getByText('В файле нет времени')).toBeOnTheScreen();
    // прочие причины — нейтрально
    expect(screen.getByText('Не удалось обработать')).toBeOnTheScreen();
  });

  it('пусто — пустое состояние', async () => {
    listUploads.mockResolvedValue(uploadPage());
    await openDevices();
    expect(await screen.findByText('Загрузок пока нет')).toBeOnTheScreen();
  });

  it('«Удалить» — подтверждение, затем запрос; строка уходит из списка', async () => {
    jest.mocked(api.deleteTrackUpload).mockResolvedValue(undefined);
    await openDevices();
    const item = within(await screen.findByTestId(`upload-${UPLOAD_ID}`));

    await fireEvent.press(item.getByRole('button', { name: 'Удалить' }));
    expect(item.getByText('Удалить заезд? Восстановить его не получится.')).toBeOnTheScreen();
    expect(api.deleteTrackUpload).not.toHaveBeenCalled();

    listUploads.mockResolvedValue(uploadPage());
    await fireEvent.press(item.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(screen.queryByTestId(`upload-${UPLOAD_ID}`)).toBeNull());
    expect(api.deleteTrackUpload).toHaveBeenCalledWith(liveSession.accessToken, UPLOAD_ID);
  });
});

describe('«Устройства»: загрузка файла (AC12)', () => {
  it.each([
    ['notes.txt', 100, 'Нужен файл FIT или GPX.'],
    ['ride.gpx', 0, 'Файл пустой.'],
    ['ride.fit', TRACK_FILE_MAX_BYTES + 1, 'Файл больше 16 МБ.'],
  ])('pre-check: %s (%d байт) — «%s» без запроса', async (name, size, message) => {
    picked(name, size);
    await openDevices();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить файл' }));
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(FakeXhr.last).toBeUndefined();
    expect(api.trackUploadRequest).not.toHaveBeenCalled();
  });

  it('выбор отменён — ничего не происходит', async () => {
    pick.mockResolvedValue({ canceled: true, assets: null });
    await openDevices();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить файл' }));
    await waitFor(() => expect(pick).toHaveBeenCalled());
    expect(FakeXhr.last).toBeUndefined();
  });

  it('прогресс и «Отменить»: запрос прерван, ошибки нет, кнопка снова доступна', async () => {
    picked('ride.gpx', 1024);
    await openDevices();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить файл' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    const xhr = FakeXhr.last as FakeXhr;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(UPLOAD_URL);
    expect(xhr.headers.authorization).toBe(`Bearer ${liveSession.accessToken}`);
    expect(api.trackUploadRequest).toHaveBeenCalledWith(liveSession.accessToken, 'ride.gpx');

    await act(async () => xhr.progress(42, 100));
    expect(screen.getByText('Загружаем ride.gpx: 42%')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Отменить' }));
    expect(xhr.aborted).toBe(true);
    expect(await screen.findByRole('button', { name: 'Загрузить файл' })).toBeOnTheScreen();
    expect(screen.queryByText(/Загружаем/)).toBeNull();
  });

  it('отказ сервера (415) — текст по коду', async () => {
    picked('ride.gpx', 1024);
    await openDevices();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить файл' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    await act(async () =>
      FakeXhr.last?.respond(415, { code: 'TRACK_FORMAT_UNSUPPORTED', message: 'x' }),
    );
    expect(await screen.findByText('Это не файл FIT или GPX.')).toBeOnTheScreen();
  });

  it('принят → «Обрабатываем…», опрос раз в 3 с до финального статуса → «Готово», затем опрос стоит', async () => {
    const queued = upload({ status: 'queued', activity: null });
    listUploads.mockResolvedValue(uploadPage());
    picked('ride.gpx', 1024);
    await openDevices();
    await screen.findByText('Загрузок пока нет');

    await fireEvent.press(screen.getByRole('button', { name: 'Загрузить файл' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    listUploads.mockResolvedValue(uploadPage(upload({ status: 'processing', activity: null })));
    await act(async () => FakeXhr.last?.respond(202, queued));

    expect(await screen.findByText('ride.gpx: Обрабатываем…')).toBeOnTheScreen();
    const callsWhileProcessing = listUploads.mock.calls.length;

    listUploads.mockResolvedValue(uploadPage(upload()));
    await act(() => jest.advanceTimersByTimeAsync(3000));
    expect(await screen.findByText('ride.gpx: Готово')).toBeOnTheScreen();
    expect(listUploads.mock.calls.length).toBeGreaterThan(callsWhileProcessing);

    const callsWhenReady = listUploads.mock.calls.length;
    await act(() => jest.advanceTimersByTimeAsync(10_000));
    expect(listUploads).toHaveBeenCalledTimes(callsWhenReady);
  });
});
