/**
 * «Как добраться» (RC-B3): в `TicketView` нет координат — внешние карты поиском по тексту адреса. https-ссылка
 * открывается одинаково на iOS, Android и web (`openExternalUrl`: системный браузер или приложение карт по universal
 * link). Только текст адреса события — без кода и данных участника.
 */
export const MAPS_SEARCH_URL = 'https://yandex.by/maps/';

export function directionsUrl(query: string): string {
  return `${MAPS_SEARCH_URL}?text=${encodeURIComponent(query)}`;
}
