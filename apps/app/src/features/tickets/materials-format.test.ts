/// <reference types="jest" />
import type { EventMaterial } from '@pokatim/contracts';

import { formatFileSize, materialAction, materialIcon, materialMeta } from './materials-format';

jest.mock('@/lib/api', () => ({
  api: { eventFileUrl: (id: string) => `https://api.test/v1/event-files/${id}` },
}));

const FILE_ID = 'a'.repeat(43);
const base: EventMaterial = {
  id: '0190a6f4-0000-7000-8000-0000000000f1',
  type: 'rules',
  title: 'Положение',
  description: null,
  url: null,
  file: null,
};

describe('материалы события — модель строки', () => {
  it('размер файла: МБ с одной цифрой после запятой, меньше мегабайта — КБ (не меньше 1)', () => {
    expect(formatFileSize(1.2 * 1024 * 1024)).toBe('1,2 МБ');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10 МБ');
    expect(formatFileSize(340 * 1024)).toBe('340 КБ');
    expect(formatFileSize(10)).toBe('1 КБ');
  });

  it('действие: https-ссылка — браузер, PDF — скачивание по адресу API, текст — раскрытие', () => {
    expect(materialAction({ ...base, url: 'https://example.by/rules' })).toEqual({
      kind: 'link',
      url: 'https://example.by/rules',
    });
    expect(
      materialAction({ ...base, file: { id: FILE_ID, name: 'rules.pdf', size: 2048 } }),
    ).toEqual({ kind: 'file', url: `https://api.test/v1/event-files/${FILE_ID}` });
    expect(materialAction({ ...base, type: 'text', description: 'Сбор в 7:30' })).toEqual({
      kind: 'text',
    });
  });

  it('небезопасная ссылка (http, учётные данные) — без действия, как текст', () => {
    expect(materialAction({ ...base, url: 'http://example.by' })).toEqual({ kind: 'text' });
    expect(materialAction({ ...base, url: 'https://user:pass@example.by' })).toEqual({
      kind: 'text',
    });
  });

  it('подпись: PDF — «PDF · размер», ссылка — домен без www, текст — нет', () => {
    expect(materialMeta({ ...base, file: { id: FILE_ID, name: 'a.pdf', size: 1258291 } })).toBe(
      'PDF · 1,2 МБ',
    );
    expect(materialMeta({ ...base, url: 'https://www.example.by/rules?x=1' })).toBe('example.by');
    expect(materialMeta({ ...base, type: 'text', description: 'Текст' })).toBeNull();
  });

  it('иконка — по теме; незнакомая тема (новый сервер) — общая иконка документа', () => {
    expect(materialIcon('pdf')).toBe('pdf');
    expect(materialIcon('link')).toBe('link');
    expect(materialIcon('parking')).toBe('parking');
    expect(materialIcon('unknown')).toBe('document');
  });
});
