import { t } from '@pokatim/i18n';

import { Button } from '../../ui';

/** Полный экран блока карты (admin-maps-desktop): развёрнут ли и переключатель. */
export type MapFullscreen = { active: boolean; onToggle: () => void };

/**
 * Кнопки камеры карты панели (routes-05, A2): «+», «−», «в рамку» — колонка сверху справа, `Button` панели с
 * `aria-label` `maps.controls.*`; значки — inline SVG без цвета (`currentColor`), для скринридера скрыты. С
 * `fullscreen` — четвёртая «На весь экран» / «Свернуть карту» (admin-maps-desktop; подпись меняется с режимом).
 */
export function MapControls({
  onZoomIn,
  onZoomOut,
  onFit,
  fullscreen,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  fullscreen?: MapFullscreen;
}) {
  const fullscreenLabel = t(
    fullscreen?.active ? 'maps.controls.exitFullscreen' : 'maps.controls.fullscreen',
  );
  return (
    <div className="map-controls">
      <Button
        size="sm"
        className="map-controls__button"
        aria-label={t('maps.controls.zoomIn')}
        title={t('maps.controls.zoomIn')}
        onClick={onZoomIn}
      >
        <Glyph path="M8 3v10M3 8h10" />
      </Button>
      <Button
        size="sm"
        className="map-controls__button"
        aria-label={t('maps.controls.zoomOut')}
        title={t('maps.controls.zoomOut')}
        onClick={onZoomOut}
      >
        <Glyph path="M3 8h10" />
      </Button>
      <Button
        size="sm"
        className="map-controls__button"
        aria-label={t('maps.controls.fit')}
        title={t('maps.controls.fit')}
        onClick={onFit}
      >
        <Glyph path="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
      </Button>
      {fullscreen ? (
        <Button
          size="sm"
          className="map-controls__button"
          aria-label={fullscreenLabel}
          title={fullscreenLabel}
          onClick={fullscreen.onToggle}
        >
          <Glyph
            path={
              fullscreen.active
                ? 'M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4'
                : 'M2 6V2h4M2 2l4 4M14 6V2h-4M14 2l-4 4M14 10v4h-4M14 14l-4-4M2 10v4h4M2 14l4-4'
            }
          />
        </Button>
      ) : null}
    </div>
  );
}

function Glyph({ path }: { path: string }) {
  return (
    <svg className="map-controls__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}
