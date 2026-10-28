import type { AppDecorId } from '@pokatim/contracts';
import type { ComponentType } from 'react';

import { HalloweenDecor } from './halloween-decor';
import { useAppDecor } from './use-app-decor';

/** Слой каждого декора; `none` — без слоя. Новый декор — строка здесь и в `APP_DECOR_IDS`. */
const DECOR_LAYER: Record<AppDecorId, ComponentType | null> = {
  none: null,
  halloween: HalloweenDecor,
};

/**
 * Сезонный декор поверх области экрана (halloween-decor): родитель — `position: relative` область контента. Включает
 * и выключает команда в панели («Оформление приложения»), без релиза.
 */
export function DecorLayer() {
  const Layer = DECOR_LAYER[useAppDecor()];
  return Layer ? <Layer /> : null;
}
