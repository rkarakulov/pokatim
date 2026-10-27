import {
  appThemes,
  appThemeScheme,
  type AppDensity,
  type AppTheme,
  type AppThemeDefinition,
  type AppThemeId,
  type AppThemeLayout,
} from '@pokatim/design-tokens';
import { ThemeProvider, useColorScheme } from '@rkarakulov/ui';
import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { themeFonts } from './fonts';
import { useThemeFonts } from './use-theme-fonts';

/** Активная тема приложения: id, разрешённая схема и её роли, иконки, раскладка, плотность. */
export interface ActiveAppTheme {
  id: AppThemeId;
  scheme: 'light' | 'dark';
  colors: AppTheme;
  icons: AppThemeDefinition['icons'];
  layout: AppThemeLayout;
  density: AppDensity;
}

export const AppThemeContext = createContext<ActiveAppTheme | null>(null);

export function activeAppTheme(def: AppThemeDefinition, scheme: 'light' | 'dark'): ActiveAppTheme {
  return {
    id: def.id,
    scheme,
    colors: def.schemes[scheme],
    icons: def.icons,
    layout: def.layout,
    density: def.density,
  };
}

export interface AppThemeProviderProps {
  themeId: AppThemeId;
  children: ReactNode;
  /** шрифты темы не загрузились — тема всё равно применяется (системные шрифты) */
  onFontError?: (error: Error) => void;
}

/**
 * Тема приложения поверх `ThemeProvider` базы (ADR-0016). Смена `themeId` применяется после загрузки шрифтов новой
 * темы: до тех пор рисуется прежняя; до первой готовой темы — `null` (корень держит сплэш). Дерево детей не
 * пересоздаётся — смена перерисовывает потребителей, состояние экранов сохраняется.
 */
export function AppThemeProvider({ themeId, children, onFontError }: AppThemeProviderProps) {
  const requested = appThemes[themeId];
  const { ready, error } = useThemeFonts(themeFonts(requested));
  const [applied, setApplied] = useState<AppThemeDefinition | null>(ready ? requested : null);
  // шрифты запрошенной темы готовы — она становится применённой (обновление состояния в рендере, без эффекта)
  if (ready && applied !== requested) setApplied(requested);
  const current = ready ? requested : applied;

  useEffect(() => {
    if (error) onFontError?.(error);
  }, [error, onFontError]);

  const system = useColorScheme();
  const value = useMemo(
    () => (current ? activeAppTheme(current, appThemeScheme(current, system)) : null),
    [current, system],
  );

  if (!current || !value) return null;
  return (
    <ThemeProvider theme={value.colors} fonts={themeFonts(current).families}>
      <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>
    </ThemeProvider>
  );
}
