import { themes } from '@pokatim/design-tokens';

/**
 * Тема карты панели (routes-05, RC-12): paint MapLibre требует значения, не CSS-переменные — слои берут роли
 * `themes.panel.map.*` (роли темы, не палитра). DOM-оверлеи карты — CSS-переменные `--color-*` (`index.css`).
 */
export const PANEL_MAP_THEME = themes.panel;
