import { describe, expect, it } from 'vitest';

import { describeMigrateError } from './migrate-error';

/** Ошибка драйвера с числовым кодом — как MongoServerError (errmsg дубликата содержит значение ключа). */
function serverError(code: number, codeName?: string): Error {
  return Object.assign(
    new Error(
      'E11000 duplicate key error collection: app.users index: users_email_uq dup key: { email: "a@b.c" }',
    ),
    { name: 'MongoServerError', code, codeName, keyValue: { email: 'a@b.c' } },
  );
}

describe('describeMigrateError (вывод db:migrate)', () => {
  it('ошибка драйвера с числовым code — только имя, код и codeName, без message и keyValue', () => {
    const text = describeMigrateError(serverError(11000, 'DuplicateKey'));
    expect(text).toBe('MongoServerError (code 11000, DuplicateKey)');
    expect(text).not.toContain('a@b.c');
    expect(describeMigrateError(serverError(85))).toBe('MongoServerError (code 85)');
  });

  it('собственная ошибка мигратора и env — полное сообщение', () => {
    expect(describeMigrateError(new Error('Миграции MongoDB уже идут'))).toBe(
      'Миграции MongoDB уже идут',
    );
  });

  it('не Error — только тип', () => {
    expect(describeMigrateError('boom')).toBe('string');
  });
});
