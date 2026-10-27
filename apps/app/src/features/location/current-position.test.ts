/// <reference types="jest" />
import * as Location from 'expo-location';

import { readCurrentPosition } from './current-position';
import { LOCATE_TIMEOUT_MS } from './position';

const getPermission = jest.mocked(Location.getForegroundPermissionsAsync);
const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
const getPosition = jest.mocked(Location.getCurrentPositionAsync);

const permission = (status: string, canAskAgain: boolean) =>
  ({ status, canAskAgain, granted: status === 'granted', expires: 'never' }) as Awaited<
    ReturnType<typeof Location.getForegroundPermissionsAsync>
  >;
const position = { coords: { longitude: 27.56, latitude: 53.9 } } as Awaited<
  ReturnType<typeof Location.getCurrentPositionAsync>
>;

beforeEach(() => {
  getPermission.mockReset();
  requestPermission.mockReset();
  getPosition.mockReset();
});

describe('readCurrentPosition native (routes-04d, RC-12)', () => {
  it('разрешение есть — одно чтение со средней точностью, без запроса разрешения', async () => {
    getPermission.mockResolvedValue(permission('granted', true));
    getPosition.mockResolvedValue(position);
    await expect(readCurrentPosition()).resolves.toEqual({ status: 'ok', lngLat: [27.56, 53.9] });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(getPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
  });

  it('не спрашивали — системный диалог, затем чтение', async () => {
    getPermission.mockResolvedValue(permission('undetermined', true));
    requestPermission.mockResolvedValue(permission('granted', true));
    getPosition.mockResolvedValue(position);
    await expect(readCurrentPosition()).resolves.toMatchObject({ status: 'ok' });
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('отказ и спросить можно (Android «Отклонить») — диалог снова; отказ — denied без ссылки', async () => {
    getPermission.mockResolvedValue(permission('denied', true));
    requestPermission.mockResolvedValue(permission('denied', true));
    await expect(readCurrentPosition()).resolves.toEqual({
      status: 'denied',
      canOpenSettings: false,
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getPosition).not.toHaveBeenCalled();
  });

  it('отказ навсегда (canAskAgain: false) — без диалога, ссылка в настройки', async () => {
    getPermission.mockResolvedValue(permission('denied', false));
    await expect(readCurrentPosition()).resolves.toEqual({
      status: 'denied',
      canOpenSettings: true,
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('сбой модуля или чтения — unavailable (не бросает)', async () => {
    getPermission.mockRejectedValue(new Error('no module'));
    await expect(readCurrentPosition()).resolves.toEqual({ status: 'unavailable' });
    getPermission.mockResolvedValue(permission('granted', true));
    getPosition.mockRejectedValue(new Error('location off'));
    await expect(readCurrentPosition()).resolves.toEqual({ status: 'unavailable' });
  });

  it('позиция не пришла за LOCATE_TIMEOUT_MS — unavailable', async () => {
    jest.useFakeTimers();
    try {
      getPermission.mockResolvedValue(permission('granted', true));
      getPosition.mockReturnValue(new Promise(() => undefined));
      const reading = readCurrentPosition();
      await jest.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS);
      await expect(reading).resolves.toEqual({ status: 'unavailable' });
    } finally {
      jest.useRealTimers();
    }
  });
});
