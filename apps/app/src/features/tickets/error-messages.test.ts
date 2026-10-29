/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';

import { isStaleTicketingError, ticketErrorMessage } from './error-messages';

const http = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: code, details });

describe('ticketErrorMessage', () => {
  it.each([
    [http(409, 'EVENT_FULL'), 'Мест больше нет.'],
    [
      http(409, 'EVENT_REGISTRATION_CLOSED', { reason: 'started' }),
      'Регистрация закрыта: старт уже начался.',
    ],
    [
      http(409, 'EVENT_REGISTRATION_CLOSED', { reason: 'unpublished' }),
      'Регистрация закрыта: старт снят с публикации.',
    ],
    [
      http(409, 'EVENT_REGISTRATION_CLOSED', { reason: 'cancelled' }),
      'Регистрация закрыта: старт отменён.',
    ],
    [
      http(409, 'EVENT_REGISTRATION_CLOSED', { reason: 'not_enabled' }),
      'Регистрация в «Покатим» на этот старт выключена.',
    ],
    [
      http(409, 'EVENT_REGISTRATION_CLOSED', { reason: 'checked_in' }),
      'Отменить нельзя: вы уже отмечены на старте.',
    ],
    [http(409, 'EVENT_REGISTRATION_CLOSED', { reason: 'later' }), 'Регистрация закрыта.'],
    [http(409, 'EVENT_REGISTRATION_CLOSED'), 'Регистрация закрыта.'],
    [http(400, 'VALIDATION_FAILED'), 'Выберите дистанцию.'],
    [
      http(429, 'RATE_LIMITED', { retryAfterSec: 30 }),
      'Слишком много попыток. Повторите через минуту.',
    ],
    [new ApiNetworkError(new Error('offline')), 'Нет соединения. Проверьте интернет и повторите.'],
    [http(500, 'INTERNAL'), 'Не удалось выполнить. Повторите позже.'],
  ])('%#: %s', (error, text) => {
    expect(ticketErrorMessage(error)).toBe(text);
  });

  it('устаревшая сводка — только «мест нет» и «закрыта»', () => {
    expect(isStaleTicketingError(http(409, 'EVENT_FULL'))).toBe(true);
    expect(isStaleTicketingError(http(409, 'EVENT_REGISTRATION_CLOSED'))).toBe(true);
    expect(isStaleTicketingError(http(400, 'VALIDATION_FAILED'))).toBe(false);
  });
});
