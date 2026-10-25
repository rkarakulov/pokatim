import { t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ErrorComponentProps, Link, Outlet, useRouter } from '@tanstack/react-router';

import { api } from '../api';
import { NAVIGATION, type NavItem } from '../navigation';
import { useMe } from '../session/me';
import { AppShell, ErrorState } from '../ui';

function NavLinks({ items }: { items: readonly NavItem[] }) {
  return items.map((item) => (
    <Link
      key={item.to}
      to={item.to}
      className="sidebar__link"
      activeOptions={{ exact: item.to === '/' }}
      activeProps={{ 'aria-current': 'page' }}
    >
      {t(item.labelKey)}
    </Link>
  ));
}

/**
 * Каркас после входа: пункты меню — из `navigation.ts` по правам сотрудника (`me.permissions`, только отображение);
 * внизу — «<Имя> · <Роль> · команда платформы» и «Выйти» (сессия отзывается, кэш очищается, — «Вход»).
 */
export function AppLayout() {
  const me = useMe();
  const queryClient = useQueryClient();
  const router = useRouter();
  const signOut = useMutation({
    mutationFn: () => api.signOut(),
    meta: { ownsUnauthorized: true },
    onSettled: async () => {
      queryClient.clear();
      await router.navigate({ to: '/sign-in', search: {} });
    },
  });
  if (!me) return <ShellSkeleton />;

  const visible = NAVIGATION.filter(
    (item) => !item.permission || me.permissions.includes(item.permission),
  );
  return (
    <AppShell
      nav={<NavLinks items={visible.filter((item) => item.group === 'main')} />}
      bottomNav={<NavLinks items={visible.filter((item) => item.group === 'bottom')} />}
      member={t('admin.shell.member', {
        name: me.user.displayName,
        role: t(`admin.role.${me.user.role}`),
      })}
      signOut={
        <button
          type="button"
          className="link-button link t-panel-crumb"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          {t('admin.shell.signOut')}
        </button>
      }
    >
      <Outlet />
    </AppShell>
  );
}

/** Первая загрузка «кто я»: тёмный сайдбар и скелетон на месте страницы (AGENTS.md §4.12). */
export function ShellSkeleton() {
  return (
    <AppShell
      nav={<span className="skeleton t-panel-nav">{' '}</span>}
      member={<span className="skeleton">{' '}</span>}
      signOut={null}
    >
      <div role="progressbar" aria-label={t('state.loading')}>
        <p className="skeleton t-panel-title">{' '}</p>
      </div>
    </AppShell>
  );
}

/** «Кто я» не загрузился не из-за сессии (сеть, 5xx): ошибка с повтором. */
export function ShellError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <main className="auth">
      <ErrorState
        error={error}
        onRetry={() => {
          reset();
          void router.invalidate();
        }}
      />
    </main>
  );
}
