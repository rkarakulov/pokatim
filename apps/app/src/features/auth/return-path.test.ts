/// <reference types="jest" />
import { rememberReturnPath, takeReturnPath } from './return-path';
import { isReturnPath } from './return-path-allowlist';

const ID = '0190a6f4-0000-7000-8000-000000000005';

describe('возврат после входа (native)', () => {
  it('allowlist: только /rides|races|calendar/<uuid>; не open redirect', () => {
    for (const ok of [`/rides/${ID}`, `/races/${ID}`, `/calendar/${ID}`]) {
      expect(isReturnPath(ok)).toBe(true);
    }
    for (const bad of [
      '/rides/not-a-uuid',
      `//evil.example/rides/${ID}`,
      `https://evil.example/rides/${ID}`,
      `/rides/${ID}/edit`,
      `/rides/${ID}?x=1`,
      `/settings/devices`,
      '/',
    ]) {
      expect(isReturnPath(bad)).toBe(false);
    }
  });

  it('allowlist: экран удаления аккаунта — только точный путь (A12, адрес для Google Play)', () => {
    expect(isReturnPath('/settings/account/delete')).toBe(true);
    for (const bad of [
      '/settings/account/delete?x=1',
      '/settings/account/delete/',
      '/settings/account/delete/1',
      '/settings/account/delete#x',
      '//evil.example/settings/account/delete',
      'https://evil.example/settings/account/delete',
      '/settings/account',
    ]) {
      expect(isReturnPath(bad)).toBe(false);
    }
  });

  it('однократно: второй take — null; путь вне allowlist не запоминается', () => {
    rememberReturnPath(`/rides/${ID}`);
    expect(takeReturnPath()).toBe(`/rides/${ID}`);
    expect(takeReturnPath()).toBeNull();
    rememberReturnPath('https://evil.example');
    expect(takeReturnPath()).toBeNull();
  });

  it('устаревший путь (старше 30 мин) — не срабатывает после постороннего входа', () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T12:00:00Z') });
    rememberReturnPath(`/rides/${ID}`);
    jest.setSystemTime(new Date('2026-10-01T12:30:00Z'));
    expect(takeReturnPath()).toBe(`/rides/${ID}`);
    rememberReturnPath(`/rides/${ID}`);
    jest.setSystemTime(new Date('2026-10-01T13:00:01Z'));
    expect(takeReturnPath()).toBeNull();
    jest.useRealTimers();
  });
});
