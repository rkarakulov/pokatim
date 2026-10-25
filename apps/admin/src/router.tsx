import type { Permission } from '@pokatim/contracts';
import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AuditScreen } from './features/audit/AuditScreen';
import { MembersScreen } from './features/members/MembersScreen';
import { NoAccessScreen } from './features/no-access/NoAccessScreen';
import { NotFoundScreen } from './features/not-found/NotFoundScreen';
import { OverviewScreen } from './features/overview/OverviewScreen';
import { SignInScreen } from './features/sign-in/SignInScreen';
import { AppLayout, ShellError, ShellSkeleton } from './layout/AppLayout';
import { Can } from './session/can';
import { isUnauthorized } from './session/errors';
import { meQuery } from './session/me';
import { safeNext } from './session/next';

export interface RouterContext {
  queryClient: QueryClient;
}

/** Параметры «Вход»: причина (`expired` — после 401) и путь возврата (только внутри панели). */
export interface SignInSearch {
  reason?: 'expired';
  next?: string;
}

/** Раздел с правом: прямой URL без права — «Нет доступа к разделу» внутри каркаса (сервер ответил бы 403). */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  return (
    <Can permission={permission} fallback={<NoAccessScreen />}>
      {children}
    </Can>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sign-in',
  // ключи — всегда явно (и `undefined`): параметры маршрута сливаются с сырыми параметрами адреса, и непрошедший
  // проверку `next` иначе остался бы сырым
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    reason: search.reason === 'expired' ? 'expired' : undefined,
    next: safeNext(search.next),
  }),
  component: SignInScreen,
});

/**
 * Защищённая ветка: `me` до рендера (`ensureQueryData`); 401 — «Вход» с возвратом на исходный путь. «Сессия истекла»
 * — только после 401 при уже открытой сессии (глобальный обработчик `query-client.ts`): первый визит без сессии —
 * просто «Вход в панель».
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      const next = safeNext(location.href);
      throw redirect({
        to: '/sign-in',
        search: next && next !== '/' ? { next } : {},
      });
    }
  },
  pendingComponent: ShellSkeleton,
  errorComponent: ShellError,
  component: AppLayout,
});

const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: OverviewScreen,
});

const membersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'members',
  component: () => (
    <RequirePermission permission="members.read">
      <MembersScreen />
    </RequirePermission>
  ),
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'audit',
  component: () => (
    <RequirePermission permission="audit.read">
      <AuditScreen />
    </RequirePermission>
  ),
});

const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: NotFoundScreen,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  appRoute.addChildren([overviewRoute, membersRoute, auditRoute, notFoundRoute]),
]);

/** basepath — из `import.meta.env.BASE_URL` (`/admin/` на стенде и в проде, `/` в `pnpm dev`). */
export function basepathOf(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function createAppRouter(options: {
  queryClient: QueryClient;
  basepath?: string;
  history?: RouterHistory;
}) {
  return createRouter({
    routeTree,
    context: { queryClient: options.queryClient },
    basepath: options.basepath ?? basepathOf(import.meta.env.BASE_URL),
    history: options.history,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
