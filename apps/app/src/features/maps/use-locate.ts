import { useCallback, useEffect, useRef, useState } from 'react';

import { readCurrentPosition } from '@/features/location/current-position';

export type LocateState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'denied'; canOpenSettings: boolean }
  | { status: 'unavailable' };

const IDLE: LocateState = { status: 'idle' };

/**
 * «Моё местоположение» (routes-04d, G1, RC-13): нажатие — одно чтение позиции (`readCurrentPosition` вызывается
 * синхронно, до любого `await`: web-запрос разрешения — из обработчика нажатия). Во время чтения повторное нажатие
 * игнорируется; после размонтирования результат отбрасывается. Позиция — только в `onPosition` (в состоянии хука её
 * нет); отказ и ошибка — состояние для сообщения, скрывается при следующем нажатии или `dismiss`.
 */
export function useLocate(onPosition: (lngLat: readonly [number, number]) => void): {
  state: LocateState;
  locate: () => void;
  dismiss: () => void;
} {
  const [state, setState] = useState<LocateState>(IDLE);
  const reading = useRef(false);
  const alive = useRef(true);
  const handler = useRef(onPosition);
  useEffect(() => {
    handler.current = onPosition;
  }, [onPosition]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const locate = useCallback(() => {
    if (reading.current) return;
    reading.current = true;
    const result = readCurrentPosition();
    setState({ status: 'pending' });
    void result.then((position) => {
      reading.current = false;
      if (!alive.current) return;
      if (position.status === 'ok') {
        setState(IDLE);
        handler.current(position.lngLat);
      } else {
        setState(position);
      }
    });
  }, []);
  const dismiss = useCallback(() => setState(IDLE), []);
  return { state, locate, dismiss };
}
