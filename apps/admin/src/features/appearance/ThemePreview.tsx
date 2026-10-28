import { t } from '@pokatim/i18n';
import type { CSSProperties } from 'react';

import type { ThemePreviewMock, ThemePreviewPalette } from './theme-previews';

/** Линия маршрута мини-макета: фиксированная форма в единицах `viewBox`. */
const ROUTE_POINTS = '4,30 18,14 30,22 44,8 58,18 76,6 96,20';

/** Мини-макет одной схемы: цвета и радиус карточки — CSS-переменные `--preview-*` из ролей схемы. */
function SchemeMock({ mock }: { mock: ThemePreviewMock }) {
  const style = {
    '--preview-canvas': mock.canvas,
    '--preview-card': mock.card,
    '--preview-text': mock.text,
    '--preview-accent': mock.accent,
    '--preview-route': mock.route,
    '--preview-radius': `${mock.radius}px`,
  } as CSSProperties;
  return (
    <span className="theme-preview__mock" style={style}>
      <span className="theme-preview__card">
        <span className="theme-preview__heading" />
        <svg className="theme-preview__route" viewBox="0 0 100 36" preserveAspectRatio="none">
          <polyline points={ROUTE_POINTS} />
        </svg>
        <span className="theme-preview__button" />
      </span>
    </span>
  );
}

/**
 * Превью темы приложения (без доменной логики): мини-макеты схем — у темы «по системе» светлая и тёмная рядом, у
 * «всегда тёмной» — одна (фон, карточка с заголовком-плашкой, акцентная кнопка-плашка, линия маршрута). Под макетами —
 * режим схемы и гарнитура заголовков подписью (шрифт панели, файлы шрифтов тем панель не грузит). Макеты декоративные:
 * смысл несут подписи.
 */
export function ThemePreview({ palette }: { palette: ThemePreviewPalette }) {
  return (
    <span className="theme-preview theme-preview--palette">
      <span className="theme-preview__mocks" aria-hidden="true">
        {palette.mocks.map((mock, index) => (
          <SchemeMock key={index} mock={mock} />
        ))}
      </span>
      <span className="theme-preview__font t-meta">
        {t(`admin.appearance.scheme.${palette.colorScheme}`)}
        {' · '}
        {t('admin.appearance.font', { name: palette.font })}
      </span>
    </span>
  );
}
