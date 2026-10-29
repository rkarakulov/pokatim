/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';
import { useInstallStore } from '@/features/pwa-install/install-store.web';
import { api } from '@/lib/api';

import { LandingScreen } from './landing-screen';

// фабрика, а не automock: модуль `api` создаёт клиента с `fetch`, которого в jsdom нет
jest.mock('@/lib/api', () => ({
  api: {
    listRaces: jest.fn(),
    getCurrentSeason: jest.fn(),
    listCatalogRoutes: jest.fn(),
    listCalendar: jest.fn(),
  },
}));
// `<Head>` заголовка документа требует дерева навигатора — здесь он не нужен
jest.mock('@/components/document-title', () => ({ DocumentTitle: () => null }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ setParams: jest.fn() }),
}));

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

const METRICS = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

const Theme = appThemeWrapper('classic');

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <Theme>
      <QueryClientProvider client={client}>
        <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
      </QueryClientProvider>
    </Theme>
  );
}

beforeEach(() => {
  // живые блоки лендинга ждут ответа (скелетоны) — плашке они не мешают
  const pending = new Promise<never>(() => undefined);
  jest.mocked(api.listRaces).mockReturnValue(pending);
  jest.mocked(api.getCurrentSeason).mockReturnValue(pending);
  jest.mocked(api.listCatalogRoutes).mockReturnValue(pending);
  jest.mocked(api.listCalendar).mockReturnValue(pending);
  jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
  jest.spyOn(navigator, 'platform', 'get').mockReturnValue('iPhone');
  localStorage.clear();
  useInstallStore.setState(useInstallStore.getInitialState(), true);
});
afterEach(() => jest.restoreAllMocks());

describe('лендинг гостя: плашка установки PWA (web)', () => {
  it('SSR — без плашки (разметка гидрации совпадает)', () => {
    const html = renderToString(
      <Providers>
        <LandingScreen />
      </Providers>,
    );
    expect(html).toContain('Катайтесь вместе');
    expect(html).not.toContain('pwa-install-banner');
  });

  it('гость на iPhone видит плашку с первого визита', async () => {
    render(
      <Providers>
        <LandingScreen />
      </Providers>,
    );
    await act(async () => undefined);
    expect(screen.getByTestId('pwa-install-banner')).toBeTruthy();
  });
});
