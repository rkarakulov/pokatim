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
import { CheckInScreen } from './features/check-in/CheckInScreen';
import { InviteScreen } from './features/invite/InviteScreen';
import { AppearanceScreen } from './features/appearance/AppearanceScreen';
import { CalendarScreen } from './features/calendar/CalendarScreen';
import { validateDisputesSearch } from './features/disputes/disputes-format';
import { DisputeScreen } from './features/disputes/DisputeScreen';
import { DisputesScreen } from './features/disputes/DisputesScreen';
import { validateRidesModerationSearch } from './features/rides-moderation/moderation-format';
import { RideModerationScreen } from './features/rides-moderation/RideModerationScreen';
import { RidesModerationScreen } from './features/rides-moderation/RidesModerationScreen';
import { allowedModerationTabs } from './features/moderation/moderation-tabs';
import { MembersScreen } from './features/members/MembersScreen';
import { NoAccessScreen } from './features/no-access/NoAccessScreen';
import { NotFoundScreen } from './features/not-found/NotFoundScreen';
import { OverviewScreen } from './features/overview/OverviewScreen';
import { NewRaceScreen, RaceScreen } from './features/races/RaceScreen';
import { RacesScreen, validateRacesSearch } from './features/races/RacesScreen';
import { RaceResultsScreen } from './features/results/RaceResultsScreen';
import { AccountErasuresScreen } from './features/account-erasures/AccountErasuresScreen';
import { RiderProfileScreen } from './features/rider-profiles/RiderProfileScreen';
import { validateRiderProfilesSearch } from './features/rider-profiles/rider-profiles-format';
import { RiderProfilesScreen } from './features/rider-profiles/RiderProfilesScreen';
import { validateRiderRoutesSearch } from './features/rider-routes/rider-routes-format';
import { RiderRouteScreen } from './features/rider-routes/RiderRouteScreen';
import { RiderRoutesScreen } from './features/rider-routes/RiderRoutesScreen';
import { RouteScreen } from './features/routes/RouteScreen';
import { RoutesScreen } from './features/routes/RoutesScreen';
import { SeasonScreen } from './features/seasons/SeasonScreen';
import { SeasonsScreen } from './features/seasons/SeasonsScreen';
import { SecurityScreen } from './features/security/SecurityScreen';
import { SignInScreen } from './features/sign-in/SignInScreen';
import { EventTicketsScreen } from './features/tickets/EventTicketsScreen';
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

// panel-invitations (ADR-0026): принятие приглашения — вне каркаса, без сессии (токен — во фрагменте адреса)
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'invite',
  component: InviteScreen,
});

/**
 * Защищённая ветка: `me` до рендера (`ensureQueryData`); 401 — «Вход» с возвратом на исходный путь. «Сессия истекла»
 * — только после 401 при уже открытой сессии (глобальный обработчик `query-client.ts`): первый визит без сессии —
 * просто «Вход в панель».
 */
/** Сессия до рендера защищённой ветки: 401 — «Вход» с возвратом на исходный путь (общий для каркаса и check-in). */
async function requireSession({
  context,
  location,
}: {
  context: RouterContext;
  location: { href: string };
}) {
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
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireSession,
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

const racesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'races',
  validateSearch: validateRacesSearch,
  component: function RacesRoute() {
    const search = racesRoute.useSearch();
    const navigate = racesRoute.useNavigate();
    return (
      <RequirePermission permission="races.read">
        <RacesScreen search={search} onSearch={(next) => void navigate({ search: next })} />
      </RequirePermission>
    );
  },
});

const newRaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'races/new',
  component: () => (
    <RequirePermission permission="races.manage">
      <NewRaceScreen />
    </RequirePermission>
  ),
});

const raceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'races/$raceId',
  component: function RaceRoute() {
    const { raceId } = raceRoute.useParams();
    return (
      <RequirePermission permission="races.read">
        <RaceScreen raceId={raceId} />
      </RequirePermission>
    );
  },
});

const raceResultsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'races/$raceId/results',
  component: function RaceResultsRoute() {
    const { raceId } = raceResultsRoute.useParams();
    return (
      <RequirePermission permission="races.read">
        <RaceResultsScreen raceId={raceId} />
      </RequirePermission>
    );
  },
});

const seasonsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'seasons',
  component: () => (
    <RequirePermission permission="races.read">
      <SeasonsScreen />
    </RequirePermission>
  ),
});

// race-results-08b: экран сезона с разделом «Рейтинг» (только чтение)
const seasonRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'seasons/$seasonId',
  component: function SeasonRoute() {
    const { seasonId } = seasonRoute.useParams();
    return (
      <RequirePermission permission="races.read">
        <SeasonScreen key={seasonId} seasonId={seasonId} />
      </RequirePermission>
    );
  },
});

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'calendar',
  component: () => (
    <RequirePermission permission="calendar.manage">
      <CalendarScreen />
    </RequirePermission>
  ),
});

// routes-01: маршруты команды и публикация в каталог (видят все с `races.read`, действия — `races.manage`)
const routesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'routes',
  component: () => (
    <RequirePermission permission="races.read">
      <RoutesScreen />
    </RequirePermission>
  ),
});

const routeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'routes/$routeId',
  component: function RouteRoute() {
    const { routeId } = routeRoute.useParams();
    return (
      <RequirePermission permission="races.read">
        <RouteScreen key={routeId} routeId={routeId} />
      </RequirePermission>
    );
  },
});

const ridesModerationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'rides-moderation',
  validateSearch: validateRidesModerationSearch,
  component: function RidesModerationRoute() {
    const search = ridesModerationRoute.useSearch();
    const navigate = ridesModerationRoute.useNavigate();
    return (
      <RequirePermission permission="rides.moderate">
        <RidesModerationScreen
          search={search}
          onSearch={(next) => void navigate({ search: next })}
        />
      </RequirePermission>
    );
  },
});

const rideModerationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'rides-moderation/$rideId',
  component: function RideModerationRoute() {
    const { rideId } = rideModerationRoute.useParams();
    return (
      <RequirePermission permission="rides.moderate">
        <RideModerationScreen rideId={rideId} />
      </RequirePermission>
    );
  },
});

const disputesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'disputes',
  validateSearch: validateDisputesSearch,
  component: function DisputesRoute() {
    const search = disputesRoute.useSearch();
    const navigate = disputesRoute.useNavigate();
    return (
      <RequirePermission permission="disputes.read">
        <DisputesScreen search={search} onSearch={(next) => void navigate({ search: next })} />
      </RequirePermission>
    );
  },
});

const disputeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'disputes/$disputeId',
  component: function DisputeRoute() {
    const { disputeId } = disputeRoute.useParams();
    return (
      <RequirePermission permission="disputes.read">
        <DisputeScreen disputeId={disputeId} />
      </RequirePermission>
    );
  },
});

// admin-moderation-hub: пункт «Модерация» — на первую доступную по правам вкладку; прав нет — «Нет доступа»
const moderationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'moderation',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    const [first] = allowedModerationTabs(me.permissions);
    if (first) throw redirect({ to: first.to, replace: true });
  },
  component: NoAccessScreen,
});

// routes-06: модерация маршрутов райдеров (admin и moderator)
const riderRoutesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'rider-routes',
  validateSearch: validateRiderRoutesSearch,
  component: function RiderRoutesRoute() {
    const search = riderRoutesRoute.useSearch();
    const navigate = riderRoutesRoute.useNavigate();
    return (
      <RequirePermission permission="routes.moderate">
        <RiderRoutesScreen search={search} onSearch={(next) => void navigate({ search: next })} />
      </RequirePermission>
    );
  },
});

const riderRouteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'rider-routes/$routeId',
  component: function RiderRouteRoute() {
    const { routeId } = riderRouteRoute.useParams();
    return (
      <RequirePermission permission="routes.moderate">
        <RiderRouteScreen key={routeId} routeId={routeId} />
      </RequirePermission>
    );
  },
});

// profile-moderation: жалобы на публичные профили райдеров (admin и moderator)
const riderProfilesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'rider-profiles',
  validateSearch: validateRiderProfilesSearch,
  component: function RiderProfilesRoute() {
    const search = riderProfilesRoute.useSearch();
    const navigate = riderProfilesRoute.useNavigate();
    return (
      <RequirePermission permission="profiles.moderate">
        <RiderProfilesScreen search={search} onSearch={(next) => void navigate({ search: next })} />
      </RequirePermission>
    );
  },
});

const riderProfileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'rider-profiles/$userId',
  component: function RiderProfileRoute() {
    const { userId } = riderProfileRoute.useParams();
    return (
      <RequirePermission permission="profiles.moderate">
        <RiderProfileScreen key={userId} userId={userId} />
      </RequirePermission>
    );
  },
});

// app-themes D1: тема приложения райдера (только admin)
const appearanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'appearance',
  component: () => (
    <RequirePermission permission="appearance.manage">
      <AppearanceScreen />
    </RequirePermission>
  ),
});

// event-tickets PR C: «Билеты и материалы» события — право по виду события проверяет сервер (403 — «Нет доступа»)
const raceTicketsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'races/$raceId/tickets',
  component: function RaceTicketsRoute() {
    const { raceId } = raceTicketsRoute.useParams();
    return <EventTicketsScreen key={raceId} kind="race" eventId={raceId} />;
  },
});

const calendarTicketsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'calendar/$startId/tickets',
  component: function CalendarTicketsRoute() {
    const { startId } = calendarTicketsRoute.useParams();
    return <EventTicketsScreen key={startId} kind="calendar" eventId={startId} />;
  },
});

/**
 * Check-in (event-tickets PR C, RC-C2): отдельная защищённая ветка без сайдбара — экран работает с телефона от
 * 360 px (каркас панели — desktop). Та же проверка сессии, что у каркаса.
 */
const checkInLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'check-in-layout',
  beforeLoad: requireSession,
  pendingComponent: ShellSkeleton,
  errorComponent: ShellError,
  component: () => (
    <main className="check-in-layout">
      <Outlet />
    </main>
  ),
});

const checkInRoute = createRoute({
  getParentRoute: () => checkInLayoutRoute,
  path: 'check-in',
  component: () => (
    <RequirePermission permission="tickets.checkin">
      <CheckInScreen />
    </RequirePermission>
  ),
});

// erasure-failures: зависшие удаления аккаунтов и повтор очистки (только admin); вход — карточка «Обзора»
const accountErasuresRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'account-erasures',
  component: () => (
    <RequirePermission permission="platform.stats">
      <AccountErasuresScreen />
    </RequirePermission>
  ),
});

// panel-2fa (ADR-0024): 2FA своего аккаунта — любая роль, без права
const securityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'account/security',
  component: SecurityScreen,
});

const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: NotFoundScreen,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  inviteRoute,
  checkInLayoutRoute.addChildren([checkInRoute]),
  appRoute.addChildren([
    overviewRoute,
    racesRoute,
    newRaceRoute,
    raceRoute,
    raceResultsRoute,
    seasonsRoute,
    seasonRoute,
    calendarRoute,
    routesRoute,
    routeRoute,
    membersRoute,
    auditRoute,
    securityRoute,
    moderationRoute,
    ridesModerationRoute,
    rideModerationRoute,
    disputesRoute,
    disputeRoute,
    appearanceRoute,
    riderRoutesRoute,
    riderRouteRoute,
    riderProfilesRoute,
    riderProfileRoute,
    raceTicketsRoute,
    calendarTicketsRoute,
    accountErasuresRoute,
    notFoundRoute,
  ]),
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
