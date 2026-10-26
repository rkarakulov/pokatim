import { ApiError, type PanelMe } from '@pokatim/contracts';
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render } from '@testing-library/react';

import { type AppRouter, createAppRouter } from '../router';
import { expiredRedirect } from '../session/expired';
import { createQueryClient } from '../session/query-client';

export const BASEPATH = '/admin';
export const USER_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

export const ME: Record<'admin' | 'moderator' | 'organizer', PanelMe> = {
  admin: {
    user: { id: USER_ID, displayName: 'Ольга', email: 'olga@example.by', role: 'admin' },
    permissions: [
      'members.read',
      'members.manage',
      'audit.read',
      'races.read',
      'races.manage',
      'races.manage_any',
      'seasons.manage',
      'calendar.manage',
      'results.manage',
      'results.revise',
    ],
  },
  moderator: {
    user: { id: USER_ID, displayName: 'Марк', email: 'mark@example.by', role: 'moderator' },
    permissions: ['audit.read', 'races.read'],
  },
  organizer: {
    user: { id: USER_ID, displayName: 'Ира', email: 'ira@example.by', role: 'organizer' },
    permissions: ['races.read', 'races.manage', 'results.manage'],
  },
};

/** Ошибка ответа API с кодом контракта — как её создаёт клиент. */
export function httpError(status: number, code: string, details?: unknown): ApiHttpError {
  return new ApiHttpError(status, { code, message: code, details }, ApiError);
}

export const unauthorized = () => httpError(401, 'UNAUTHORIZED');
export const networkError = () => new ApiNetworkError(new TypeError('fetch failed'));

/** Панель целиком (роутер с basepath `/admin`, память вместо адресной строки) на заглушках `api`. */
export async function renderApp(path: string) {
  const holder: { router?: AppRouter } = {};
  const queryClient = createQueryClient({
    onUnauthorized: () => {
      if (holder.router) expiredRedirect(holder.router);
    },
  });
  // повторы запросов (сеть, 5xx) в тестах экранов не нужны: состояние ошибки — сразу
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const history = createMemoryHistory({ initialEntries: [`${BASEPATH}${path}`] });
  const router = createAppRouter({ queryClient, basepath: BASEPATH, history });
  holder.router = router;
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return { router, queryClient, history };
}

/** Путь в «адресной строке» (с basepath). */
export const currentHref = (router: AppRouter) => router.state.location.publicHref;
