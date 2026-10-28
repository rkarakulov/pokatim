import { useCallback, useRef, useState } from 'react';

import { useLocate, type LocateState } from '@/features/maps/use-locate';

import { roundNear, type NearQuery } from './near';

/**
 * Номер чтения позиции — на весь процесс (не на экземпляр экрана): после перемонтирования вкладки новое чтение не
 * совпадёт с ключом кэша прежней позиции того же `QueryClient` (ревью pass 1). Непрозрачный, без координат.
 */
let lastRead = 0;

export interface NearState {
  /** чип «Рядом» включён */
  active: boolean;
  /** позиция получена (округлена) — фильтр ленты и карты; `null` — ещё нет или выключено */
  near: NearQuery | null;
  /** чтение позиции: ожидание, отказ, ошибка (пустое состояние без разрешения) */
  locate: LocateState;
  /** нажатие чипа: включить (одно чтение) или выключить (позиция стирается) */
  toggle: () => void;
  /** «Разрешить» — повторное чтение */
  retry: () => void;
  /** выключить «Рядом» («Выбрать город») */
  off: () => void;
}

/**
 * «Рядом» вкладки «Райды» (05c, ADR-0014 поправка 05c): нажатие — одно foreground-чтение позиции через `useLocate`
 * (`readCurrentPosition` синхронно в обработчике — web), позиция сразу округляется до 0,01° и живёт только в состоянии
 * экрана; `seq` (номер чтения на процесс) растёт на каждое успешное чтение — он, а не координаты, идёт в ключ запроса. Повторное нажатие
 * выключает и стирает позицию; ответ чтения после выключения отбрасывается.
 */
export function useNear(): NearState {
  const [active, setActive] = useState(false);
  const [near, setNear] = useState<NearQuery | null>(null);
  const activeRef = useRef(false);
  const onPosition = useCallback((lngLat: readonly [number, number]) => {
    if (!activeRef.current) return;
    lastRead += 1;
    setNear({ seq: lastRead, lngLat: roundNear(lngLat) });
  }, []);
  const { state, locate, dismiss } = useLocate(onPosition);

  const off = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    setNear(null);
    dismiss();
  }, [dismiss]);
  const toggle = useCallback(() => {
    if (activeRef.current) return off();
    activeRef.current = true;
    setActive(true);
    locate();
  }, [locate, off]);

  return { active, near, locate: state, toggle, retry: locate, off };
}
