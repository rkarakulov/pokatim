/// <reference types="jest" />
import { rememberReturnPath, takeReturnPath } from './return-path';
import { RETURN_PATH_KEY } from './return-path-allowlist';

const ID = '0190a6f4-0000-7000-8000-000000000005';

describe('возврат после входа (web)', () => {
  afterEach(() => sessionStorage.clear());

  it('путь — и в sessionStorage вкладки (переживает перезагрузку), снимается при чтении', () => {
    rememberReturnPath(`/rides/${ID}`);
    expect(JSON.parse(sessionStorage.getItem(RETURN_PATH_KEY) ?? '{}')).toMatchObject({
      path: `/rides/${ID}`,
    });
    expect(takeReturnPath()).toBe(`/rides/${ID}`);
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull();
    expect(takeReturnPath()).toBeNull();
  });

  it('после перезагрузки (память пуста) — из sessionStorage; подменённое значение вне allowlist — null', () => {
    const stored = (path: string, at = Date.now()) =>
      sessionStorage.setItem(RETURN_PATH_KEY, JSON.stringify({ path, at }));
    stored(`/calendar/${ID}`);
    expect(takeReturnPath()).toBe(`/calendar/${ID}`);
    // старше 30 минут — не срабатывает
    stored(`/calendar/${ID}`, Date.now() - 31 * 60_000);
    expect(takeReturnPath()).toBeNull();
    sessionStorage.setItem(RETURN_PATH_KEY, `/calendar/${ID}`);
    expect(takeReturnPath()).toBeNull();
    stored('//evil.example/x');
    expect(takeReturnPath()).toBeNull();
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull();
  });

  it('экран удаления аккаунта переживает перезагрузку вкладки (вход → возврат, A12)', () => {
    rememberReturnPath('/settings/account/delete');
    expect(takeReturnPath()).toBe('/settings/account/delete');
    sessionStorage.setItem(
      RETURN_PATH_KEY,
      JSON.stringify({ path: '/settings/account/delete?x=1', at: Date.now() }),
    );
    expect(takeReturnPath()).toBeNull();
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
