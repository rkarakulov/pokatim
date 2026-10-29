/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { InstallBanner } from './install-banner';
import { INSTALL_PROMPT_KEY, MS_IN_DAY } from './install-prompt-state';
import { useInstallStore } from './install-store.web';

const mockSetParams = jest.fn();
jest.mock('expo-router', () => ({ useNavigation: () => ({ setParams: mockSetParams }) }));

const UA = {
  safari26:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  safari17:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

const METRICS = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

const NOW = new Date('2026-10-29T10:00:00Z').getTime();

function browser(userAgent: string, { standalone = false, platform = 'iPhone' } = {}) {
  jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  jest.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
}

const stored = () => JSON.parse(localStorage.getItem(INSTALL_PROMPT_KEY) ?? 'null');

async function renderBanner() {
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <InstallBanner />
    </SafeAreaProvider>,
    { wrapper: appThemeWrapper('classic') },
  );
  // ответ getInstalledRelatedApps (нет API — «не установлено»)
  await act(async () => undefined);
}

function fireBeforeInstallPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = jest.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

beforeEach(() => {
  // окна — без анимации появления и закрытия
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.useFakeTimers({ now: NOW });
  localStorage.clear();
  useInstallStore.setState(useInstallStore.getInitialState(), true);
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockSetParams.mockReset();
});

describe('плашка установки PWA (web)', () => {
  it('SSR — пусто (условия читаются после монтирования)', () => {
    const Wrapper = appThemeWrapper('classic');
    const html = renderToString(
      <Wrapper>
        <SafeAreaProvider initialMetrics={METRICS}>
          <InstallBanner />
        </SafeAreaProvider>
      </Wrapper>,
    );
    expect(html).not.toContain('pwa-install-banner');
  });

  it('новый пользователь: плашка с первого визита', async () => {
    browser(UA.safari26);
    await renderBanner();
    expect(screen.getByTestId('pwa-install-banner')).toBeTruthy();
  });

  it('до 7 дней после «×» — плашки нет', async () => {
    browser(UA.safari26);
    localStorage.setItem(
      INSTALL_PROMPT_KEY,
      JSON.stringify({ closedTimestamp: NOW - 7 * MS_IN_DAY + 1 }),
    );
    await renderBanner();
    expect(screen.queryByTestId('pwa-install-banner')).toBeNull();
  });

  it('iOS Safari 26: нажатие на плашку — инструкция с картинками iOS 26', async () => {
    browser(UA.safari26);
    await renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Установить приложение' }));
    expect(screen.getByTestId('pwa-install-ios')).toBeTruthy();
    expect(screen.getByText('1. Нажмите «Поделиться» в панели браузера')).toBeTruthy();
    expect(screen.getByTestId('pwa-install-share-ios26')).toBeTruthy();
    expect(screen.getByTestId('pwa-install-home-ios26')).toBeTruthy();
  });

  it('iOS Safari 17 — картинки _old; «×» инструкции не трогает хранилище', async () => {
    browser(UA.safari17);
    await renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Установить приложение' }));
    expect(screen.getByTestId('pwa-install-share-legacy')).toBeTruthy();
    expect(screen.getByTestId('pwa-install-home-legacy')).toBeTruthy();
    fireEvent.click(screen.getByTestId('pwa-install-modal-close'));
    expect(screen.queryByTestId('pwa-install-ios')).toBeNull();
    expect(screen.getByTestId('pwa-install-banner')).toBeTruthy();
    expect(stored()).toEqual({});
  });

  it('«×» плашки: скрыть и запомнить время закрытия', async () => {
    browser(UA.safari26);
    await renderBanner();
    fireEvent.click(screen.getByTestId('pwa-install-banner-close'));
    expect(screen.queryByTestId('pwa-install-banner')).toBeNull();
    expect(stored()).toEqual({ closedTimestamp: NOW });
  });

  it('через 7 дней после «×» — снова', async () => {
    browser(UA.safari26);
    localStorage.setItem(
      INSTALL_PROMPT_KEY,
      JSON.stringify({ closedTimestamp: NOW - 7 * MS_IN_DAY }),
    );
    await renderBanner();
    expect(screen.getByTestId('pwa-install-banner')).toBeTruthy();
  });

  it('standalone (открыто как PWA) — плашки нет', async () => {
    browser(UA.safari26, { standalone: true });
    await renderBanner();
    expect(screen.queryByTestId('pwa-install-banner')).toBeNull();
  });

  it('десктоп — плашки нет', async () => {
    browser(UA.desktop, { platform: 'MacIntel' });
    await renderBanner();
    fireBeforeInstallPrompt();
    expect(screen.queryByTestId('pwa-install-banner')).toBeNull();
  });

  it('Android: плашка только после beforeinstallprompt, нажатие — нативный диалог', async () => {
    browser(UA.android, { platform: 'Linux armv8l' });
    await renderBanner();
    expect(screen.queryByTestId('pwa-install-banner')).toBeNull();
    const { event, prompt } = fireBeforeInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Установить приложение' }));
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    // событие одноразовое: без нового beforeinstallprompt плашки нет
    expect(screen.queryByTestId('pwa-install-banner')).toBeNull();
  });

  it('установлено (getInstalledRelatedApps) — плашки нет', async () => {
    browser(UA.android, { platform: 'Linux armv8l' });
    Object.defineProperty(navigator, 'getInstalledRelatedApps', {
      value: () => Promise.resolve([{ platform: 'webapp' }]),
      configurable: true,
    });
    await renderBanner();
    fireBeforeInstallPrompt();
    expect(screen.queryByTestId('pwa-install-banner')).toBeNull();
    delete (navigator as { getInstalledRelatedApps?: unknown }).getInstalledRelatedApps;
  });

  it('?show-pwa-modal: параметр убран, промо; «Установить» — инструкция iOS', async () => {
    browser(UA.safari26);
    window.history.replaceState(null, '', '/?show-pwa-modal&tab=1');
    await renderBanner();
    expect(window.location.search).toBe('?tab=1');
    // и из состояния навигатора: иначе переход на Главную по вкладке вернёт параметр в адрес
    expect(mockSetParams).toHaveBeenCalledWith({ 'show-pwa-modal': undefined });
    expect(screen.getByTestId('pwa-install-promo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Установить' }));
    expect(screen.queryByTestId('pwa-install-promo')).toBeNull();
    expect(screen.getByTestId('pwa-install-ios')).toBeTruthy();
  });

  it('без ?show-pwa-modal параметры роутера не трогаем', async () => {
    browser(UA.safari26);
    await renderBanner();
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('appinstalled до ответа getInstalledRelatedApps — плашки нет', async () => {
    browser(UA.safari26);
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    await renderBanner();
    expect(screen.queryByTestId('pwa-install-banner')).toBeNull();
  });

  it('?show-pwa-modal в standalone — промо нет', async () => {
    browser(UA.safari26, { standalone: true });
    window.history.replaceState(null, '', '/?show-pwa-modal');
    await renderBanner();
    expect(window.location.search).toBe('');
    expect(screen.queryByTestId('pwa-install-promo')).toBeNull();
  });
});
