import { t } from '@pokatim/i18n';

import { Button } from '../../ui';

/**
 * Кнопки камеры карты панели (routes-05, A2): «+», «−», «в рамку» — колонка сверху справа, `Button` панели с
 * `aria-label` `maps.controls.*`; значки — inline SVG без цвета (`currentColor`), для скринридера скрыты.
 */
export function MapControls({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
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
