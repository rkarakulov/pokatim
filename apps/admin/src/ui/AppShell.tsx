import { t } from '@pokatim/i18n';
import type { ReactNode } from 'react';

/**
 * Каркас «Протокол»: тёмный сайдбар (`--density-sidebar-width`, `--nav-*`) — бренд, подпись панели, навигация
 * (основная группа сверху, служебная — внизу над блоком сотрудника; ссылки рендерит вызывающий — роутер), блок
 * сотрудника и выход; справа — страница. Кандидат в `admin-kit` (F6): о домене не знает.
 */
export function AppShell({
  nav,
  bottomNav,
  member,
  signOut,
  children,
}: {
  nav: ReactNode;
  bottomNav?: ReactNode;
  member: ReactNode;
  signOut: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="sidebar__brand t-brand">{t('app.name')}</p>
        <p className="sidebar__role t-label">{t('admin.title')}</p>
        <nav aria-label={t('admin.nav.label')} className="sidebar__navs">
          <div className="sidebar__nav t-panel-nav">{nav}</div>
          {bottomNav ? (
            <div className="sidebar__nav sidebar__nav--bottom t-panel-nav">{bottomNav}</div>
          ) : null}
        </nav>
        <div className="sidebar__me t-panel-crumb">
          <span>{member}</span>
          {signOut}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
