/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';

import { ImagePickerUnavailableError, ImagePrecheckError } from '@/features/media/picked-image';

import { ridePhotoErrorMessage } from './ride-photo-errors';

const http = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: 'x', ...(details ? { details } : {}) });

describe('тексты ошибок фото райда (ride-photo, AC7)', () => {
  it.each([
    [415, 'IMAGE_FORMAT_UNSUPPORTED', 'Выберите фото в формате JPEG, PNG или WebP'],
    [413, 'IMAGE_TOO_LARGE', 'Фото больше 10 МБ — выберите фото поменьше'],
    [422, 'IMAGE_INVALID', 'Не удалось обработать фото — выберите другое'],
  ])('%s %s — понятный текст', (status, code, text) => {
    expect(ridePhotoErrorMessage(http(status, code))).toBe(text);
  });

  it('422 too_small — «слишком маленькое или вытянутое»; unreadable и незнакомая причина — «не удалось обработать»', () => {
    expect(ridePhotoErrorMessage(http(422, 'IMAGE_INVALID', { reason: 'too_small' }))).toBe(
      'Фото слишком маленькое или слишком вытянутое — выберите другое',
    );
    expect(ridePhotoErrorMessage(http(422, 'IMAGE_INVALID', { reason: 'unreadable' }))).toBe(
      'Не удалось обработать фото — выберите другое',
    );
    expect(ridePhotoErrorMessage(http(422, 'IMAGE_INVALID', { reason: 'later' }))).toBe(
      'Не удалось обработать фото — выберите другое',
    );
  });

  it('429: занятая обработка (5 с) — «подождите»; часовой лимит — «Повторите через …»', () => {
    expect(ridePhotoErrorMessage(http(429, 'RATE_LIMITED', { retryAfterSec: 5 }))).toBe(
      'Фото сейчас обрабатываются. Подождите несколько секунд',
    );
    expect(ridePhotoErrorMessage(http(429, 'RATE_LIMITED', { retryAfterSec: 1800 }))).toBe(
      'Слишком много загрузок фото. Повторите через 30:00',
    );
  });

  it('409 RIDE_INVALID_STATE — фото только к будущему райду', () => {
    expect(ridePhotoErrorMessage(http(409, 'RIDE_INVALID_STATE'))).toBe(
      'Фото можно добавить только к будущему райду',
    );
  });

  it('проверка до отправки — тот же текст, что у ответа сервера; старый dev-клиент — «обновите приложение»', () => {
    expect(ridePhotoErrorMessage(new ImagePrecheckError('tooLarge'))).toBe(
      'Фото больше 10 МБ — выберите фото поменьше',
    );
    expect(ridePhotoErrorMessage(new ImagePrecheckError('formatUnsupported'))).toBe(
      'Выберите фото в формате JPEG, PNG или WebP',
    );
    expect(ridePhotoErrorMessage(new ImagePickerUnavailableError())).toBe(
      'Чтобы выбрать фото, обновите приложение',
    );
  });

  it('удаление: лимит изменений — общий текст действия с райдом, не про загрузки фото', () => {
    expect(ridePhotoErrorMessage(http(429, 'RATE_LIMITED', { retryAfterSec: 5 }), 'delete')).toBe(
      'Слишком часто. Повторите через 5 с.',
    );
  });

  it('сеть — «Нет соединения.»', () => {
    expect(ridePhotoErrorMessage(new ApiNetworkError(new Error('offline')))).toBe(
      'Нет соединения.',
    );
  });
});
