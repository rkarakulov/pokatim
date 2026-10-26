/// <reference types="jest" />
import { rememberReturnPath, takeReturnPath } from './return-path';
import { RETURN_PATH_KEY } from './return-path-allowlist';

const ID = '0190a6f4-0000-7000-8000-000000000005';

describe('возврат после входа (web)', () => {
  afterEach(() => sessionStorage.clear());

  it('путь — и в sessionStorage вкладки (переживает перезагрузку), снимается при чтении', () => {
    rememberReturnPath(`/rides/${ID}`);
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBe(`/rides/${ID}`);
    expect(takeReturnPath()).toBe(`/rides/${ID}`);
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull();
    expect(takeReturnPath()).toBeNull();
  });

  it('после перезагрузки (память пуста) — из sessionStorage; подменённое значение вне allowlist — null', () => {
    sessionStorage.setItem(RETURN_PATH_KEY, `/calendar/${ID}`);
    expect(takeReturnPath()).toBe(`/calendar/${ID}`);
    sessionStorage.setItem(RETURN_PATH_KEY, '//evil.example/x');
    expect(takeReturnPath()).toBeNull();
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull();
  });

  it('хранилище недоступно — только память, без исключения', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => rememberReturnPath(`/races/${ID}`)).not.toThrow();
    expect(takeReturnPath()).toBe(`/races/${ID}`);
    spy.mockRestore();
  });
});
