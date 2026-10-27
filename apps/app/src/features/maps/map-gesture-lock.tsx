import { createContext, useCallback, useRef, useState } from 'react';

/**
 * Блокировка прокрутки экрана на время жеста карты двумя пальцами (routes-04b, RC-3): native `RouteMap` сообщает
 * `true` на активации жеста карты и `false` после последнего активного. По умолчанию — no-op (карта вне провайдера
 * работает). Web контекст не вызывает: браузер разводит жесты сам (`touch-action` кооперативного режима).
 */
export const MapGestureLockContext = createContext<(active: boolean) => void>(() => undefined);

/**
 * Экран с картой: `scrollEnabled` выключен, пока идёт жест карты (ре-рендер экрана — дважды за жест);
 * `onMapGesture` — значение провайдера `MapGestureLockContext` (стабильная ссылка).
 */
export function useMapGestureLock(): readonly [
  scrollEnabled: boolean,
  onMapGesture: (active: boolean) => void,
] {
  const [active, setActive] = useState(false);
  const last = useRef(false);
  const onMapGesture = useCallback((next: boolean) => {
    if (last.current === next) return;
    last.current = next;
    setActive(next);
  }, []);
  return [!active, onMapGesture] as const;
}
