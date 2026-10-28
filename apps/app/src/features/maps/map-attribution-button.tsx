import { space, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { StyleSheet } from 'react-native';

import { MapIconButton } from './map-controls';

/**
 * Кнопка атрибуции карты «i» (ADR-0014 п. 3: OSM и провайдер тайлов видны по нажатию) — своя, в стиле кнопок камеры,
 * вместо кнопки MapLibre (на картах читалась точкой без смысла). Нижний левый угол (RC-6), над шторкой — со сдвигом
 * на `bottomInset`. Нажатие: native — диалог атрибуции MapLibre (`MapRef.showAttribution`), web — плашка контрола
 * MapLibre (`collapseAttribution` → переключатель, `attributionPanelCss`).
 */
export function MapAttributionButton({
  theme,
  bottomInset = 0,
  onPress,
}: {
  theme: AppTheme;
  bottomInset?: number;
  onPress: () => void;
}) {
  return (
    <MapIconButton
      theme={theme}
      testID="map-attribution"
      label={t('maps.controls.attribution')}
      icon="info"
      onPress={onPress}
      style={[styles.corner, { bottom: space.s2 + bottomInset }]}
    />
  );
}

const styles = StyleSheet.create({
  corner: { position: 'absolute', left: space.s2 },
});
