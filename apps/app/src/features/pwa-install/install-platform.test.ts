import {
  instructionVariant,
  isIosDevice,
  isMobileBrowser,
  isStandaloneDisplay,
  safariMajorVersion,
  type BrowserInfo,
} from './install-platform';

const UA = {
  safari26:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  safari17:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

const info = (userAgent: string, platform = '', maxTouchPoints = 0): BrowserInfo => ({
  userAgent,
  platform,
  maxTouchPoints,
});

describe('детект iOS/iPadOS', () => {
  it('iPhone — по user agent', () => {
    expect(isIosDevice(info(UA.safari26, 'iPhone', 5))).toBe(true);
    expect(isIosDevice(info(UA.chromeIos, 'iPhone', 5))).toBe(true);
  });

  it('iPadOS (MacIntel с сенсорным экраном) — iOS, Mac без касаний — нет', () => {
    expect(isIosDevice(info(UA.ipadOs, 'MacIntel', 5))).toBe(true);
    expect(isIosDevice(info(UA.ipadOs, 'MacIntel', 0))).toBe(false);
  });

  it('Android и десктоп — не iOS', () => {
    expect(isIosDevice(info(UA.android, 'Linux armv8l', 5))).toBe(false);
    expect(isIosDevice(info(UA.desktopChrome, 'MacIntel', 0))).toBe(false);
  });
});

describe('мобильный браузер', () => {
  it('iPhone, iPad и Android — да; десктоп — нет', () => {
    expect(isMobileBrowser(info(UA.safari17, 'iPhone', 5))).toBe(true);
    expect(isMobileBrowser(info(UA.ipadOs, 'MacIntel', 5))).toBe(true);
    expect(isMobileBrowser(info(UA.android, 'Linux armv8l', 5))).toBe(true);
    expect(isMobileBrowser(info(UA.desktopChrome, 'MacIntel', 0))).toBe(false);
  });
});

describe('детект standalone', () => {
  it('navigator.standalone (iOS) или display-mode: standalone', () => {
    expect(isStandaloneDisplay(true, false)).toBe(true);
    expect(isStandaloneDisplay(undefined, true)).toBe(true);
    expect(isStandaloneDisplay(false, false)).toBe(false);
    expect(isStandaloneDisplay(undefined, false)).toBe(false);
  });
});

describe('картинки инструкции', () => {
  it('версия Safari — из Version/N; у Chrome на iOS и десктопного Chrome — нет', () => {
    expect(safariMajorVersion(UA.safari26)).toBe(26);
    expect(safariMajorVersion(UA.safari17)).toBe(17);
    expect(safariMajorVersion(UA.chromeIos)).toBeNull();
    expect(safariMajorVersion(UA.desktopChrome)).toBeNull();
  });

  it('Safari 26+ — ios26, Safari 17 и другие браузеры на iOS — legacy', () => {
    expect(instructionVariant(UA.safari26)).toBe('ios26');
    expect(instructionVariant(UA.safari26.replace('Version/26.0', 'Version/27.1'))).toBe('ios26');
    expect(instructionVariant(UA.safari17)).toBe('legacy');
    expect(instructionVariant(UA.chromeIos)).toBe('legacy');
  });
});
