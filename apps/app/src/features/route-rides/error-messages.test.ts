/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';

import { routeRideErrorMessage } from './error-messages';

const http = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: 'x', ...(details ? { details } : {}) });

describe('ошибки заезда по маршруту (route-rides-02)', () => {
  it('сеть — «Нет соединения»', () => {
    expect(
      routeRideErrorMessage(new ApiNetworkError(new TypeError('Network request failed'))),
    ).toBe('Нет соединения. Проверьте подключение к интернету и повторите.');
  });

  it.each([
    [2400, 40],
    [30, 1],
    [61, 2],
  ])('429 через %i с — «через %i мин.» (RC-10)', (retryAfterSec, minutes) => {
    expect(routeRideErrorMessage(http(429, 'RATE_LIMITED', { retryAfterSec }))).toBe(
      `Слишком много проверок за час. Попробуйте через ${minutes} мин.`,
    );
  });

  it('429 без деталей — 60 мин.', () => {
    expect(routeRideErrorMessage(http(429, 'RATE_LIMITED'))).toBe(
      'Слишком много проверок за час. Попробуйте через 60 мин.',
    );
  });

  it('коды 409 и 404', () => {
    expect(routeRideErrorMessage(http(409, 'ROUTE_RIDE_NOT_READY'))).toBe(
      'Файл ещё обрабатывается — откройте выбор позже',
    );
    expect(routeRideErrorMessage(http(409, 'ROUTE_RIDE_UPLOAD_FAILED'))).toBe(
      'Файл заезда не удалось обработать',
    );
    expect(routeRideErrorMessage(http(409, 'ROUTE_RIDE_QUOTA_EXCEEDED'))).toBe(
      'По этому маршруту уже 100 заездов — это предел',
    );
    expect(routeRideErrorMessage(http(404, 'NOT_FOUND'))).toBe('Маршрут или заезд недоступен');
  });

  it('прочее — общий текст действия', () => {
    expect(routeRideErrorMessage(http(500, 'INTERNAL'))).toBe(
      routeRideErrorMessage(http(400, 'VALIDATION_FAILED')),
    );
    expect(routeRideErrorMessage(new Error('x'))).not.toMatch(/проверок|Файл/);
  });
});
