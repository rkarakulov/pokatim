import type { AppRouter } from '../router';
import { safeNext } from './next';

/**
 * Сессия панели погашена на открытой странице (401): «Вход» с «Сессия истекла» и возвратом на ту же страницу. Уже
 * на «Входе» — ничего (повторные 401 параллельных запросов).
 */
export function expiredRedirect(router: AppRouter): void {
  const location = router.state.location;
  if (location.pathname === '/sign-in') return;
  const next = safeNext(location.href);
  void router.navigate({
    to: '/sign-in',
    search: { reason: 'expired', ...(next ? { next } : {}) },
  });
}
