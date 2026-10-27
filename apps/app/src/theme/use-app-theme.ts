import { DEFAULT_THEME, type AppTheme } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';
import { useContext } from 'react';

import { activeAppTheme, AppThemeContext, type ActiveAppTheme } from './app-theme-provider';

/**
 * Активная тема приложения (токены pokatim, иконки, раскладка). Без `AppThemeProvider` (тесты компонентов) —
 * «Классика» со схемой темы базы (`useTheme()`: проп или система).
 */
export function useAppTheme(): ActiveAppTheme {
  const context = useContext(AppThemeContext);
  const colors = useTheme<AppTheme>();
  if (context) return context;
  return { ...activeAppTheme(DEFAULT_THEME, colors.map.basemap), colors };
}
