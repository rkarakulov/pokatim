/// <reference types="jest" />
import { directionsUrl } from './maps-link';

describe('directionsUrl (RC-B3)', () => {
  it('https-поиск по тексту адреса, текст экранирован', () => {
    expect(directionsUrl('пр. Победителей, 1, Минск')).toBe(
      'https://yandex.by/maps/?text=%D0%BF%D1%80.%20%D0%9F%D0%BE%D0%B1%D0%B5%D0%B4%D0%B8%D1%82%D0%B5%D0%BB%D0%B5%D0%B9%2C%201%2C%20%D0%9C%D0%B8%D0%BD%D1%81%D0%BA',
    );
  });

  it('спецсимволы не ломают запрос и не добавляют параметров', () => {
    const url = new URL(directionsUrl('a&b=c#d?e'));
    expect(url.protocol).toBe('https:');
    expect([...url.searchParams.keys()]).toEqual(['text']);
    expect(url.searchParams.get('text')).toBe('a&b=c#d?e');
  });
});
