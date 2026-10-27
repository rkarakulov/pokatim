import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

/**
 * QueryClient для рендера маршрутов без корневого layout: без повторов, чтобы ошибка была видна сразу.
 * Новый клиент на каждый вызов — кеш одного теста не попадает в другой. Корень жестов — как `GestureRoot` корневого
 * layout (routes-04b: карта на native всегда держит `GestureDetector`).
 */
export function createQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <GestureHandlerRootView>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </GestureHandlerRootView>
    );
  };
}
