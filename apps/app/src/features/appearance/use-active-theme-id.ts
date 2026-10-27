import { DEFAULT_APP_THEME_ID, type AppThemeId } from '@pokatim/contracts';
import { useEffect, useRef, useState } from 'react';

import { readCachedThemeId, saveCachedThemeId } from './appearance-cache';
import { useAppearanceQuery } from './appearance-query';
import { initialThemeId } from './initial-theme-id';

/**
 * Активная тема приложения: ответ сервера, до него — кэш native / SSR web (`initialThemeId`), без них — «Классика».
 * `null` — native, кэш ещё читается (корень держит сплэш, даже если сервер уже ответил). Ответ сервера кэшируется (native), ошибка запроса —
 * остаётся последняя известная.
 */
export function useActiveThemeId(): AppThemeId | null {
  const [known, setKnown] = useState<AppThemeId | null>(initialThemeId);
  const { data } = useAppearanceQuery();
  // последнее значение сервера — новая «последняя известная» (сброс кэша запросов при выходе её не теряет); native —
  // только после чтения кэша: сплэш держится, пока кэш не прочитан, даже если сервер ответил раньше
  if (known !== null && data !== undefined && data !== known) setKnown(data);

  // что лежит в кэше устройства: `undefined` — ещё не прочитан
  const stored = useRef<AppThemeId | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void readCachedThemeId().then((cached) => {
      if (stored.current === undefined) stored.current = cached;
      if (active) setKnown((current) => current ?? cached ?? DEFAULT_APP_THEME_ID);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (data === undefined || data === stored.current) return;
    stored.current = data;
    void saveCachedThemeId(data);
  }, [data]);

  return known === null ? null : (data ?? known);
}
