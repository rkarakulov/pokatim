import { t } from '@pokatim/i18n';
import type { CSSProperties } from 'react';

import type { ThemePreviewPalette } from './theme-previews';

/** Линия маршрута мини-макета: фиксированная форма в единицах `viewBox`. */
const ROUTE_POINTS = '4,30 18,14 30,22 44,8 58,18 76,6 96,20';

/**
 * Мини-макет темы приложения (без доменной логики): фон, карточка с заголовком-плашкой, акцентная кнопка-плашка, линия
 * маршрута. Цвета — CSS-переменные `--preview-*` из палитры токенов; без палитры — нейтральный макет на переменных
 * панели и подпись «Превью появится позже». Картинка декоративная: смысл несёт подпись карточки.
 */
export function ThemePreview({ palette }: { palette: ThemePreviewPalette | null }) {
  const style = palette
    ? ({
        '--preview-canvas': palette.canvas,
        '--preview-card': palette.card,
        '--preview-text': palette.text,
        '--preview-accent': palette.accent,
        '--preview-route': palette.route,
      } as CSSProperties)
    : undefined;
  return (
    <span className={`theme-preview${palette ? ' theme-preview--palette' : ''}`} style={style}>
      <span className="theme-preview__mock" aria-hidden="true">
        <span className="theme-preview__card">
          <span className="theme-preview__heading" />
          <svg className="theme-preview__route" viewBox="0 0 100 36" preserveAspectRatio="none">
            <polyline points={ROUTE_POINTS} />
          </svg>
          <span className="theme-preview__button" />
        </span>
      </span>
      {palette ? null : (
        <span className="theme-preview__pending t-meta">
          {t('admin.appearance.previewPending')}
        </span>
      )}
    </span>
  );
}
