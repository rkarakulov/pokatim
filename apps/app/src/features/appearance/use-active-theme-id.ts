import { DEFAULT_APP_THEME_ID, type AppThemeId } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { fetchProfile, PROFILE_QUERY_KEY } from '@/features/home/queries';

import { clearCachedThemeId, readCachedThemeId, saveCachedThemeId } from './appearance-cache';
import { initialThemeId } from './initial-theme-id';
import { toAppThemeId } from './theme-id';

/**
 * Активная тема приложения (user-theme, ADR-0021) — единственный источник для корня:
 * - вошёл — тема профиля (`['profile']`: тот же ключ и запрос, что у Главной; перезапрос на фокус — смена темы с другого
 *   устройства); пока профиль не пришёл или в ошибке — последняя известная;
 * - сессия неизвестна — последняя известная: кэш native (`pokatim.appTheme`) / SSR web из cookie (`initialThemeId`);
 * - `signedOut` (выход, отзыв сервером, refresh 401, запуск без сессии) — «Классика», кэш / cookie стираются (RC-2).
 * Тема профиля пишется в кэш / cookie, «Классика» — стирает их (RC-8). `null` — native, кэш ещё читается (корень
 * держит сплэш, даже если профиль уже пришёл).
 */
export function useActiveThemeId(): AppThemeId | null {
  const signedOut = useSessionStore((state) => state.status === 'signedOut');
  const signedIn = useSessionStore((state) => isSignedIn(state));
  const [known, setKnown] = useState<AppThemeId | null>(initialThemeId);
  const { data } = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: fetchProfile,
    enabled: signedIn,
    select: (profile) => toAppThemeId(profile.themeId),
  });
  // тема, которую требует сервер или сессия; `undefined` — ещё не известна (остаётся последняя известная)
  const target = signedOut ? DEFAULT_APP_THEME_ID : data;
  // native — только после чтения кэша: сплэш держится, пока кэш не прочитан
  if (known !== null && target !== undefined && target !== known) setKnown(target);

  useEffect(() => {
    let active = true;
    void readCachedThemeId().then((cached) => {
      if (active) setKnown((current) => current ?? cached ?? DEFAULT_APP_THEME_ID);
    });
    return () => {
      active = false;
    };
  }, []);

  // запись — в эффекте (web: cookie не пишется при рендере); «Классика» не хранится — стирание
  useEffect(() => {
    if (target === undefined) return;
    void (target === DEFAULT_APP_THEME_ID ? clearCachedThemeId() : saveCachedThemeId(target));
  }, [target]);

  return known === null ? null : (target ?? known);
}
