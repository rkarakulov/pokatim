import * as Font from 'expo-font';
import { useEffect, useState } from 'react';

import type { ThemeFontSet } from './fonts';

export interface ThemeFontsState {
  /** шрифты набора загружены (или загрузка упала — тогда работают системные) */
  ready: boolean;
  error: Error | null;
}

const READY: ThemeFontsState = { ready: true, error: null };

const allLoaded = (set: ThemeFontSet) =>
  Object.keys(set.assets).every((name) => Font.isLoaded(name));

/**
 * native и клиент web: грузит набор при каждой смене (`useFonts` expo-font читает карту один раз — смена темы на
 * лету его не перезагрузила бы). Уже загруженное (бандл native, `@font-face` из SSR при гидрации) — готово сразу.
 */
function useClientThemeFonts(set: ThemeFontSet): ThemeFontsState {
  const [state, setState] = useState(() => ({
    set,
    ...(allLoaded(set) ? READY : { ready: false, error: null }),
  }));

  useEffect(() => {
    // уже загружен — готовность выводится в рендере (`allLoaded` ниже)
    if (allLoaded(set)) return;
    let active = true;
    Font.loadAsync(set.assets).then(
      () => {
        if (active) setState({ set, ...READY });
      },
      (error: unknown) => {
        if (active) setState({ set, ready: true, error: error as Error });
      },
    );
    return () => {
      active = false;
    };
  }, [set]);

  // набор сменился, эффект ещё не отработал — состояние прежнего набора не годится
  if (state.set !== set) return allLoaded(set) ? READY : { ready: false, error: null };
  return { ready: state.ready, error: state.error };
}

/**
 * web-сервер: `loadAsync` синхронно в рендере регистрирует `@font-face` набора в контексте запроса — expo-router
 * выводит в HTML только шрифты активной темы (`#expo-generated-fonts`, preload).
 */
function useServerThemeFonts(set: ThemeFontSet): ThemeFontsState {
  void Font.loadAsync(set.assets);
  return READY;
}

/**
 * Шрифты темы (`themeFonts(def)`). Развилка — по `window`, как `useFonts` expo-font: сервер — только web SSR, на
 * native и в браузере `window` есть. Выбор при загрузке модуля — один хук на весь процесс.
 */
export const useThemeFonts =
  typeof window === 'undefined' ? useServerThemeFonts : useClientThemeFonts;
