/**
 * @jest-environment-options {"url": "https://pokatim.by/"}
 */
/// <reference types="jest" />
import { saveCachedThemeId } from './appearance-cache';

// страница по https (RC-7): cookie темы — с Secure; jsdom не даёт подменить `location`, поэтому — свой адрес файла
describe('кэш темы (web, https)', () => {
  it('cookie pokatim_theme — с Secure', async () => {
    const proto = Object.getPrototypeOf(document) as Document;
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    const writes: string[] = [];
    const spy = jest.spyOn(proto, 'cookie', 'set').mockImplementation((value: string) => {
      writes.push(value);
      descriptor.set!.call(document, value);
    });
    await saveCachedThemeId('journal');
    expect(writes[0]!.split(';').map((part) => part.trim())).toEqual([
      'pokatim_theme=journal',
      'Path=/',
      'Max-Age=31536000',
      'SameSite=Lax',
      'Secure',
    ]);
    spy.mockRestore();
  });
});
