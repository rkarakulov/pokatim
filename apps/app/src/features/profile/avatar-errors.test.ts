/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';

import { avatarErrorMessage } from './avatar-errors';
import { AvatarPickerUnavailableError, AvatarPrecheckError } from './picked-avatar';

const http = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: 'x', ...(details ? { details } : {}) });

describe('тексты ошибок фото профиля (AC14)', () => {
  it.each([
    [415, 'AVATAR_FORMAT_UNSUPPORTED', 'Выберите фото в формате JPEG, PNG или WebP'],
    [413, 'AVATAR_TOO_LARGE', 'Фото больше 10 МБ — выберите фото поменьше'],
    [422, 'AVATAR_INVALID', 'Не удалось обработать фото — выберите другое'],
  ])('%s %s — понятный текст', (status, code, text) => {
    expect(avatarErrorMessage(http(status, code))).toBe(text);
  });

  it('429 с паузой — «Повторите через …»; без паузы — общий текст лимита', () => {
    expect(avatarErrorMessage(http(429, 'RATE_LIMITED', { retryAfterSec: 5 }))).toBe(
      'Слишком много загрузок фото. Повторите через 0:05',
    );
    expect(avatarErrorMessage(http(429, 'RATE_LIMITED'))).not.toContain('фото');
  });

  it('проверка до отправки — тот же текст, что у ответа сервера; мелкое фото — 64 × 64', () => {
    expect(avatarErrorMessage(new AvatarPrecheckError('AVATAR_TOO_LARGE'))).toBe(
      'Фото больше 10 МБ — выберите фото поменьше',
    );
    expect(avatarErrorMessage(new AvatarPrecheckError('AVATAR_FORMAT_UNSUPPORTED'))).toBe(
      'Выберите фото в формате JPEG, PNG или WebP',
    );
    expect(avatarErrorMessage(new AvatarPrecheckError('tooSmall'))).toBe(
      'Фото слишком маленькое — нужно хотя бы 64 × 64 пикселя',
    );
  });

  it('старый dev-клиент — «Обновите приложение»; сеть — общий текст', () => {
    expect(avatarErrorMessage(new AvatarPickerUnavailableError())).toBe(
      'Чтобы выбрать фото, обновите приложение',
    );
    expect(avatarErrorMessage(new ApiNetworkError(new TypeError('Network request failed')))).toBe(
      'Нет соединения. Проверьте подключение к интернету и повторите.',
    );
  });
});
