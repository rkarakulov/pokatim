/// <reference types="jest" />
import { PROMPT_WAIT_MS } from './location-permission.web';
import { readCurrentPosition } from './current-position';
import { LOCATE_MAX_AGE_MS } from './position';

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

const PERMISSION_DENIED = 1;
const positionError = (code: number) =>
  ({
    code,
    PERMISSION_DENIED,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    message: '',
  }) as GeolocationPositionError;

function setGeolocation(value: unknown) {
  Object.defineProperty(navigator, 'geolocation', { value, configurable: true });
}
function geolocationWith(answer: (success: Success, failure: Failure) => void) {
  const getCurrentPosition = jest.fn(
    (success: Success, failure: Failure, _options?: PositionOptions) => answer(success, failure),
  );
  setGeolocation({ getCurrentPosition, watchPosition: jest.fn(), clearWatch: jest.fn() });
  return getCurrentPosition;
}
const coords = { coords: { longitude: 27.56, latitude: 53.9 } } as GeolocationPosition;

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

describe('readCurrentPosition web (routes-04d, G4, RC-12)', () => {
  it('getCurrentPosition — синхронно (до первого микротаска), без высокой точности; позиция — lngLat', async () => {
    const watch = jest.fn();
    const get = geolocationWith((success) => setTimeout(() => success(coords), 0));
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: get, watchPosition: watch, clearWatch: jest.fn() },
      configurable: true,
    });
    const reading = readCurrentPosition();
    // вызов — в том же такте, что нажатие (Safari показывает запрос только из обработчика)
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![2]).toMatchObject({
      enableHighAccuracy: false,
      maximumAge: LOCATE_MAX_AGE_MS,
    });
    await expect(reading).resolves.toEqual({ status: 'ok', lngLat: [27.56, 53.9] });
    // без слежения
    expect(watch).not.toHaveBeenCalled();
  });

  it('отказ — denied без ссылки в настройки (браузер)', async () => {
    geolocationWith((_success, failure) => failure(positionError(PERMISSION_DENIED)));
    await expect(readCurrentPosition()).resolves.toEqual({
      status: 'denied',
      canOpenSettings: false,
    });
  });

  it('таймаут или позиция недоступна — unavailable', async () => {
    geolocationWith((_success, failure) => failure(positionError(3)));
    await expect(readCurrentPosition()).resolves.toEqual({ status: 'unavailable' });
  });

  it('нет API, небезопасный контекст, бросок — unavailable', async () => {
    setGeolocation(undefined);
    await expect(readCurrentPosition()).resolves.toEqual({ status: 'unavailable' });
    geolocationWith(() => undefined);
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    await expect(readCurrentPosition()).resolves.toEqual({ status: 'unavailable' });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    geolocationWith(() => {
      throw new Error('blocked');
    });
    await expect(readCurrentPosition()).resolves.toEqual({ status: 'unavailable' });
  });

  it('пользователь не ответил на запрос — unavailable через PROMPT_WAIT_MS', async () => {
    jest.useFakeTimers();
    try {
      geolocationWith(() => undefined);
      const reading = readCurrentPosition();
      jest.advanceTimersByTime(PROMPT_WAIT_MS);
      await expect(reading).resolves.toEqual({ status: 'unavailable' });
    } finally {
      jest.useRealTimers();
    }
  });
});
