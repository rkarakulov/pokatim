/// <reference types="jest" />
import { clearCachedThemeId, readCachedThemeId, saveCachedThemeId } from './appearance-cache';

// запись cookie — через сеттер `document.cookie`: jsdom не отдаёт атрибуты при чтении, поэтому проверяем строки записи
let writes: string[] = [];
let cookieSpy: jest.SpyInstance;

beforeEach(() => {
  writes = [];
  const proto = Object.getPrototypeOf(document) as Document;
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
  cookieSpy = jest.spyOn(proto, 'cookie', 'set').mockImplementation((value: string) => {
    writes.push(value);
    descriptor.set!.call(document, value);
  });
});
afterEach(() => {
  cookieSpy.mockRestore();
  document.cookie = 'pokatim_theme=; Path=/; Max-Age=0';
});

const attributes = (cookie: string) => cookie.split(';').map((part) => part.trim());

describe('кэш темы (web) — cookie pokatim_theme (user-theme)', () => {
  it('запись: id темы, Path=/, SameSite=Lax, Max-Age ~1 год; без Secure на http', async () => {
    await saveCachedThemeId('atlas');
    expect(writes).toHaveLength(1);
    expect(attributes(writes[0]!)).toEqual([
      'pokatim_theme=atlas',
      'Path=/',
      'Max-Age=31536000',
      'SameSite=Lax',
    ]);
    expect(document.cookie).toContain('pokatim_theme=atlas');
  });

  it('стирание — Max-Age=0', async () => {
    await saveCachedThemeId('atlas');
    await clearCachedThemeId();
    expect(attributes(writes[1]!)).toEqual([
      'pokatim_theme=',
      'Path=/',
      'Max-Age=0',
      'SameSite=Lax',
    ]);
    expect(document.cookie).not.toContain('pokatim_theme');
  });

  it('чтение — null: тему до ответа сервера даёт SSR (window.__POKATIM_THEME__)', async () => {
    await saveCachedThemeId('atlas');
    expect(await readCachedThemeId()).toBeNull();
  });
});
