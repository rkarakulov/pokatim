import { type RefObject, useCallback, useEffect, useState } from 'react';

const isSupported = () =>
  typeof document !== 'undefined' &&
  document.fullscreenEnabled === true &&
  typeof HTMLElement.prototype.requestFullscreen === 'function';

/**
 * Полный экран узла `ref` (admin-maps-desktop): блок «карта + профиль» страницы маршрута. `toggle` — развернуть узел
 * или свернуть его же; `active` — развёрнут именно он (по `fullscreenchange`: выход по Esc тоже виден). Отказ браузера
 * (нет жеста пользователя, запрет политикой, iframe) — промис гасится, режим не меняется; без Fullscreen API
 * (`fullscreenEnabled` ≠ true) — `supported: false`, кнопку не показывают.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [supported] = useState(isSupported);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const update = () =>
      setActive(ref.current !== null && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [ref, supported]);

  const toggle = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const request =
      document.fullscreenElement === node ? document.exitFullscreen() : node.requestFullscreen();
    request.catch(() => {});
  }, [ref]);

  return { supported, active, toggle };
}
