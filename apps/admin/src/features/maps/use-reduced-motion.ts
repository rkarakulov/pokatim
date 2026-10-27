import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

const hasMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * «Уменьшить движение» системы (routes-05): камера карты по кнопкам — без анимации. Без `matchMedia` — как
 * «уменьшить» (анимации нет). Подписка на смену настройки.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    hasMatchMedia() ? window.matchMedia(QUERY).matches : true,
  );
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const media = window.matchMedia(QUERY);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
