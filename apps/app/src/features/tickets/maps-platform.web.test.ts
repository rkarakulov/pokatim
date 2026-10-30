/// <reference types="jest" />
import { mapsPlatform } from './maps-platform';

function browser(userAgent: string, platform = '', maxTouchPoints = 0) {
  jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  jest.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  // в jsdom у navigator нет maxTouchPoints — задаём своё на тест
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
});

describe('mapsPlatform (web): карты по устройству браузера', () => {
  it('Android Chrome — geo:', () => {
    browser(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
    );
    expect(mapsPlatform()).toBe('android');
  });

  it('iPhone Safari — Apple Maps', () => {
    browser(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    );
    expect(mapsPlatform()).toBe('ios');
  });

  it('iPadOS представляется Mac — по сенсорному экрану тоже Apple Maps', () => {
    browser(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      'MacIntel',
      5,
    );
    expect(mapsPlatform()).toBe('ios');
  });

  it('десктоп — Яндекс Карты', () => {
    browser(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
      'Win32',
    );
    expect(mapsPlatform()).toBe('other');
  });
});
