import { mapsPlatform, type MapsPlatform } from './maps-platform';

/**
 * «Как добраться» (RC-B3): в `TicketView` нет координат — внешние карты поиском по тексту адреса. Карты — системные:
 * Android — `geo:` (приложение карт по умолчанию или выбор), iOS/iPadOS — Apple Maps (`maps.apple.com` открывает
 * приложение по universal link); остальное (десктоп) — Яндекс Карты (лучшее покрытие адресов Беларуси). Только текст
 * адреса события — без кода и данных участника.
 */
export const MAPS_FALLBACK_URL = 'https://yandex.by/maps/';
export const APPLE_MAPS_URL = 'https://maps.apple.com/';

export function directionsUrlFor(platform: MapsPlatform, query: string): string {
  const text = encodeURIComponent(query);
  switch (platform) {
    case 'android':
      return `geo:0,0?q=${text}`;
    case 'ios':
      return `${APPLE_MAPS_URL}?q=${text}`;
    case 'other':
      return `${MAPS_FALLBACK_URL}?text=${text}`;
  }
}

/** Ссылка для этой платформы; вызывать в обработчике нажатия (web читает `navigator`). */
export const directionsUrl = (query: string): string => directionsUrlFor(mapsPlatform(), query);
