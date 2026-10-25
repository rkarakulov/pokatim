/// <reference types="jest" />
import { getLocationPermission, requestLocationPermission } from './location-permission';

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

const PERMISSION_DENIED = 1;
const TIMEOUT = 3;
const positionError = (code: number) =>
  ({
    code,
    PERMISSION_DENIED,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT,
    message: '',
  }) as GeolocationPositionError;

function setNavigator(key: 'geolocation' | 'permissions', value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true });
}
const permissionsWith = (state: PermissionState | undefined) =>
  state === undefined ? undefined : { query: jest.fn(async () => ({ state })) };

/** Geolocation, вызывающая колбэк по сценарию теста. */
function geolocationWith(answer: (success: Success, failure: Failure) => void) {
  const getCurrentPosition = jest.fn((success: Success, failure: Failure) =>
    answer(success, failure),
  );
  return { getCurrentPosition, watchPosition: jest.fn(), clearWatch: jest.fn() };
}

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  setNavigator(
    'geolocation',
    geolocationWith(() => undefined),
  );
  setNavigator('permissions', permissionsWith('prompt'));
});

describe('getLocationPermission (web)', () => {
  it.each([
    ['prompt', 'undetermined'],
    ['granted', 'granted'],
    ['denied', 'denied'],
  ] as const)('Permissions API %s → %s', async (state, expected) => {
    setNavigator('permissions', permissionsWith(state));
    await expect(getLocationPermission()).resolves.toBe(expected);
  });

  it('нет Permissions API (старые Safari) → undetermined (экран покажется, решит флаг)', async () => {
    setNavigator('permissions', undefined);
    await expect(getLocationPermission()).resolves.toBe('undetermined');
  });

  it('нет navigator.geolocation или небезопасный контекст → unavailable', async () => {
    setNavigator('geolocation', undefined);
    await expect(getLocationPermission()).resolves.toBe('unavailable');
    setNavigator(
      'geolocation',
      geolocationWith(() => undefined),
    );
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    await expect(getLocationPermission()).resolves.toBe('unavailable');
  });
});

describe('requestLocationPermission (web)', () => {
  it('успех → granted; позиция из колбэка не читается (coords не трогаются)', async () => {
    setNavigator('permissions', undefined);
    const coords = jest.fn();
    const position = Object.defineProperty({}, 'coords', { get: coords }) as GeolocationPosition;
    const geo = geolocationWith((success) => success(position));
    setNavigator('geolocation', geo);

    await expect(requestLocationPermission()).resolves.toBe('granted');
    expect(coords).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      {
        maximumAge: Infinity,
        timeout: 30_000,
        enableHighAccuracy: false,
      },
    );
  });

  it('PERMISSION_DENIED → denied', async () => {
    setNavigator('permissions', undefined);
    setNavigator(
      'geolocation',
      geolocationWith((_s, failure) => failure(positionError(PERMISSION_DENIED))),
    );
    await expect(requestLocationPermission()).resolves.toBe('denied');
  });

  it('таймаут — итог по Permissions API (разрешено, хотя позиции нет)', async () => {
    setNavigator('permissions', permissionsWith('granted'));
    setNavigator(
      'geolocation',
      geolocationWith((_s, failure) => failure(positionError(TIMEOUT))),
    );
    await expect(requestLocationPermission()).resolves.toBe('granted');
  });

  it('таймаут без Permissions API → undetermined', async () => {
    setNavigator('permissions', undefined);
    setNavigator(
      'geolocation',
      geolocationWith((_s, failure) => failure(positionError(TIMEOUT))),
    );
    await expect(requestLocationPermission()).resolves.toBe('undetermined');
  });

  it('нет navigator.geolocation → unavailable без запроса', async () => {
    setNavigator('geolocation', undefined);
    await expect(requestLocationPermission()).resolves.toBe('unavailable');
  });
});
