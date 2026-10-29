import { describe, expect, it } from 'vitest';

import { erasureErrorCode } from './account-erasure';

describe('erasureErrorCode (erasure-failures)', () => {
  it('строковый токен кода, числовой код драйвера, имя класса', () => {
    expect(erasureErrorCode(Object.assign(new Error('x'), { code: 'ECONNECTION' }))).toBe(
      'ECONNECTION',
    );
    expect(erasureErrorCode(Object.assign(new Error('x'), { code: 11000 }))).toBe('11000');
    expect(erasureErrorCode(new TypeError('to a@b.by'))).toBe('TypeError');
  });

  it('небезопасный код или имя — unknown; текст ошибки не используется', () => {
    expect(erasureErrorCode({ code: 'a@b.by', name: 'bad name' })).toBe('unknown');
    expect(erasureErrorCode({ code: 1.5, name: 'x@y' })).toBe('unknown');
    expect(erasureErrorCode('smtp to a@b.by')).toBe('unknown');
    expect(erasureErrorCode(null)).toBe('unknown');
  });
});
