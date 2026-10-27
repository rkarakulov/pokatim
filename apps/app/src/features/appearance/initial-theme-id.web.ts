import type { AppThemeId } from '@pokatim/contracts';

import { ssrThemeId } from './ssr-theme';
import { toAppThemeId } from './theme-id';

/** web: сервер — тема процесса; клиент — та же, что отдал SSR (`window.__POKATIM_THEME__`): гидрация без мигания. */
export function initialThemeId(): AppThemeId {
  return typeof window === 'undefined' ? ssrThemeId() : toAppThemeId(window.__POKATIM_THEME__);
}
