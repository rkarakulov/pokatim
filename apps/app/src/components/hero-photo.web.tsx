import { useEffect, useRef, type CSSProperties } from 'react';

import type { HeroPhotoProps } from './hero-photo';

const style: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
};

/**
 * Декоративное фото героя (web): обычный `<img alt="">` — есть уже в серверном HTML (SSR) и гидрируется без
 * расхождения (`expo-image` на web монтирует картинку только в эффекте). Ошибка до гидрации (событие `error` прошло
 * до подписки React) — по `complete && naturalWidth === 0` после монтирования.
 */
export function HeroPhoto({ uri, onError }: HeroPhotoProps) {
  const ref = useRef<HTMLImageElement>(null);
  // проверка идемпотентна: повтор на новом `onError` родителя безвреден, дальше ошибки приходят событием
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) onError();
  }, [uri, onError]);
  return (
    <img
      ref={ref}
      data-testid="section-hero-photo"
      src={uri}
      alt=""
      decoding="async"
      style={style}
      onError={onError}
    />
  );
}
