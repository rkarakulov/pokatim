import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { useMe } from '../../session/me';
import { overviewQuery } from '../overview/overview-query';
import { allowedModerationTabs } from './moderation-tabs';

/**
 * Вкладки раздела «Модерация» под шапкой списочного экрана очереди: только разрешённые, текущая — `aria-current`.
 * Счётчик — из «Обзора»; загрузка, ошибка и ноль — без счётчика (экран очереди от него не зависит).
 */
export function ModerationTabs() {
  const me = useMe();
  // переключение вкладок в пределах 30 с не перезапрашивает весь «Обзор» (findings LOW-1)
  const overview = useQuery({ ...overviewQuery(), staleTime: 30_000 });
  const attention = overview.data?.attention;
  return (
    <nav className="tabs t-body" aria-label={t('admin.moderation.tabs')}>
      {allowedModerationTabs(me?.permissions ?? []).map((tab) => {
        const count = attention ? tab.count(attention) : undefined;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className="tabs__link"
            activeOptions={{ includeSearch: false }}
            activeProps={{ 'aria-current': 'page' }}
          >
            {t(tab.labelKey)}
            {count ? (
              <>
                {' '}
                <span className="tabs__count t-meta">
                  <span aria-hidden="true">{count}</span>
                  <span className="visually-hidden">
                    {t('admin.moderation.tabCount', { count })}
                  </span>
                </span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
