import { appThemes, appThemeScheme, type AppThemeId } from '@pokatim/design-tokens';
import { ThemeProvider } from '@rkarakulov/ui';
import type { ReactNode } from 'react';

import { activeAppTheme, AppThemeContext } from '@/theme/app-theme-provider';
import { themeFonts } from '@/theme/fonts';

/**
 * Обёртка рендера темой приложения (app-themes C): то же, что даёт `AppThemeProvider` (роли и шрифты темы в
 * `ThemeProvider`, контекст иконок и раскладки), но без загрузки файлов — тема применяется сразу и в native-, и в
 * web-проекте jest. Загрузку шрифтов проверяют тесты провайдера. Схема — светлая (у «всегда тёмных» — тёмная).
 */
export function appThemeWrapper(themeId: AppThemeId) {
  const def = appThemes[themeId];
  const value = activeAppTheme(def, appThemeScheme(def, 'light'));
  return function AppThemeWrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider theme={value.colors} fonts={themeFonts(def).families}>
        <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>
      </ThemeProvider>
    );
  };
}
