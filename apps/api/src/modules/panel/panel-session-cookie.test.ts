import { describe, expect, it } from 'vitest';

import { requestCookie } from './panel-session-cookie';

const NAME = '__Secure-pokatim_admin_sid';

describe('requestCookie', () => {
  it('из заголовка Cookie: нужная среди других, пробелы и URL-кодирование', () => {
    const request = { headers: { cookie: `a=1; ${NAME}=abc%2Dx ;b=2` } };
    expect(requestCookie(request, NAME)).toBe('abc-x');
    expect(requestCookie(request, 'b')).toBe('2');
  });

  it('нет заголовка, нет cookie, похожее имя — undefined', () => {
    expect(requestCookie({ headers: {} }, NAME)).toBeUndefined();
    expect(requestCookie({ headers: { cookie: `x${NAME}=1` } }, NAME)).toBeUndefined();
  });

  it('битое кодирование — значение как есть (проверит OpaqueToken)', () => {
    expect(requestCookie({ headers: { cookie: `${NAME}=%E0%A4%A` } }, NAME)).toBe('%E0%A4%A');
  });

  it('объект cookies плагина — только собственные ключи', () => {
    expect(requestCookie({ cookies: { [NAME]: 'v' } }, NAME)).toBe('v');
    expect(requestCookie({ cookies: {} }, 'constructor')).toBeUndefined();
  });
});
