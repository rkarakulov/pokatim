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

  it('однократно: второй take — null; путь вне allowlist не запоминается', () => {
    rememberReturnPath(`/rides/${ID}`);
    expect(takeReturnPath()).toBe(`/rides/${ID}`);
    expect(takeReturnPath()).toBeNull();
    rememberReturnPath('https://evil.example');
    expect(takeReturnPath()).toBeNull();
  });
});
