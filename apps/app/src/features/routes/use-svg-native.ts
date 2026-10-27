import { useEffect, useState } from 'react';

import { loadSvgNative } from './load-svg-native';
import { svgSupported } from './svg-support';

export type SvgLib = Awaited<ReturnType<typeof loadSvgNative>>;

/**
 * `react-native-svg` после монтирования (native): `null` — грузится, `false` — модуля в сборке нет (старый
 * dev-клиент). Общий для графика профиля и контура маршрута.
 */
export function useSvgLib(): SvgLib | false | null {
  const [lib, setLib] = useState<SvgLib | false | null>(() => (svgSupported() ? null : false));
  useEffect(() => {
    if (lib !== null) return;
    let cancelled = false;
    loadSvgNative()
      .then((loaded) => {
        if (!cancelled) setLib(loaded);
      })
      .catch(() => {
        if (!cancelled) setLib(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lib]);
  return lib;
}
