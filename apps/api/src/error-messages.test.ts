import type { ArgumentsHost } from '@nestjs/common';
import { ApiError, BASE_ERROR_CODES, ErrorCode } from '@pokatim/contracts';
import { ApiExceptionFilter, isDomainError, type ApiErrorMessages } from '@rkarakulov/api-kit/core';
import { describe, expect, it } from 'vitest';

import { domainError, PROJECT_ERROR_MESSAGES } from './error-messages';

/** Ответ фильтра ошибок базы со словарём pokatim — как в AppModule. */
function respond(error: unknown) {
  let status = 0;
  let body: unknown;
  const reply = {
    status(code: number) {
      status = code;
      return reply;
    },
    header: () => reply,
    send(payload: unknown) {
      body = payload;
      return reply;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter(PROJECT_ERROR_MESSAGES).catch(error, host);
  return { status, body: ApiError.parse(body) };
}

describe('сообщения кодов ошибок pokatim', () => {
  it('у каждого кода pokatim (вне кодов базы) есть текст', () => {
    const projectCodes = ErrorCode.options.filter(
      (code) => !(BASE_ERROR_CODES as readonly string[]).includes(code),
    );
    const messages: ApiErrorMessages = PROJECT_ERROR_MESSAGES;
    expect(projectCodes).not.toEqual([]);
    for (const code of projectCodes) {
      expect(messages[code], code).toMatch(/\S/);
    }
  });

  it('фильтр базы отдаёт тексты pokatim, а не общий текст по статусу', () => {
    expect(respond(domainError('EMAIL_TAKEN', 409)).body).toEqual({
      code: 'EMAIL_TAKEN',
      message: 'E-mail уже зарегистрирован',
    });
    expect(respond(domainError('EMAIL_UNAVAILABLE', 409)).body.message).toBe(
      'E-mail недоступен для регистрации',
    );
    expect(respond(domainError('LINK_EXPIRED', 410, { email: 'a@b.by' }))).toEqual({
      status: 410,
      body: { code: 'LINK_EXPIRED', message: 'Ссылка устарела', details: { email: 'a@b.by' } },
    });
  });

  it('domainError — DomainError базы с кодом контракта, статусом и деталями', () => {
    const error = domainError('RATE_LIMITED', 429, { retryAfterSec: 5 });
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      details: { retryAfterSec: 5 },
    });
  });
});
