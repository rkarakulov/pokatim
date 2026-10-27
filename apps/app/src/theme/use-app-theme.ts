import { appThemeScheme, DEFAULT_THEME, type AppTheme } from '@pokatim/design-tokens';
import { useColorScheme, useTheme } from '@rkarakulov/ui';
import { useContext } from 'react';

import { activeAppTheme, AppThemeContext, type ActiveAppTheme } from './app-theme-provider';

/**
 * Активная тема приложения (токены pokatim, иконки, раскладка). Без `AppThemeProvider` (тесты компонентов) —
 * «Классика»: схема — по системной схеме базы (как у провайдера), роли — `useTheme()` (проп или система).
 */
export function useAppTheme(): ActiveAppTheme {
  const context = useContext(AppThemeContext);
  const colors = useTheme<AppTheme>();
  const system = useColorScheme();
  if (context) return context;
  return { ...activeAppTheme(DEFAULT_THEME, appThemeScheme(DEFAULT_THEME, system)), colors };
}
