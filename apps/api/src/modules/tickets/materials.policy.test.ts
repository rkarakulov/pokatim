import { describe, expect, it } from 'vitest';

import { contentDisposition, isPdf, MATERIALS_POLICY, safeFileName } from './materials.policy';

describe('materials.policy (event-tickets PR C)', () => {
  it('isPdf — сигнатура `%PDF-` строго с нулевого смещения', () => {
    expect(isPdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    expect(isPdf(Buffer.from('<html>%PDF-1.7'))).toBe(false);
    expect(isPdf(Buffer.from('%PDF'))).toBe(false);
    expect(isPdf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });

  it('safeFileName — без разделителей пути, кавычек и управляющих символов, расширение .pdf', () => {
    expect(safeFileName('Положение гонки.pdf')).toBe('Положение гонки.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd.pdf');
    expect(safeFileName('a"b\\c.PDF')).toBe('a_b_c.PDF');
    expect(safeFileName('rules\r\nSet-Cookie: x')).toBe('rulesSet-Cookie: x.pdf');
    expect(safeFileName('   ')).toBe('material.pdf');
    expect(safeFileName(`${'я'.repeat(200)}.pdf`)).toHaveLength(MATERIALS_POLICY.fileNameMax);
    expect(safeFileName(`${'я'.repeat(200)}.pdf`).endsWith('.pdf')).toBe(true);
  });

  it('contentDisposition — attachment, ASCII-заглушка и filename* (RFC 5987) без CRLF и кавычек', () => {
    expect(contentDisposition('rules.pdf')).toBe(
      `attachment; filename="material.pdf"; filename*=UTF-8''rules.pdf`,
    );
    const value = contentDisposition(`Правила "o'k" (2026).pdf`);
    expect(value).toBe(
      `attachment; filename="material.pdf"; filename*=UTF-8''%D0%9F%D1%80%D0%B0%D0%B2%D0%B8%D0%BB%D0%B0%20_o%27k_%20%282026%29.pdf`,
    );
    expect(contentDisposition('a\r\nb.pdf')).not.toMatch(/[\r\n]/);
  });
});
