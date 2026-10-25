import { designSystemCss } from '@pokatim/design-tokens';

import { panelLayoutCss } from './panel-tokens';

/**
 * Переменные темы panel и классы `.t-*` из пакета — до первого рендера, без ручных копий; плюс размеры раскладки
 * панели (`panel-tokens.ts`, временно до токенов базы — Q17).
 */
export function installDesignSystem(
  doc: Pick<Document, 'createElement' | 'head'> = document,
): void {
  const style = doc.createElement('style');
  style.id = 'design-system';
  style.textContent = designSystemCss({ theme: 'panel' }) + panelLayoutCss();
  doc.head.prepend(style);
}
