/// <reference types="jest" />
import { directionsUrlFor } from './maps-link';

const ADDRESS = 'пр. Победителей, 1, Минск';

describe('directionsUrlFor (RC-B3): системные карты поиском по адресу', () => {
  it('Android — geo: (карты по умолчанию или выбор приложения)', () => {
    expect(directionsUrlFor('android', ADDRESS)).toBe(`geo:0,0?q=${encodeURIComponent(ADDRESS)}`);
  });

  it('iOS/iPadOS — Apple Maps', () => {
    expect(directionsUrlFor('ios', ADDRESS)).toBe(
      `https://maps.apple.com/?q=${encodeURIComponent(ADDRESS)}`,
    );
  });

  it('остальное (десктоп) — Яндекс Карты', () => {
    expect(directionsUrlFor('other', ADDRESS)).toBe(
      `https://yandex.by/maps/?text=${encodeURIComponent(ADDRESS)}`,
    );
  });

  it.each(['ios', 'other'] as const)(
    '%s: спецсимволы не ломают запрос и не добавляют параметров',
    (platform) => {
      const url = new URL(directionsUrlFor(platform, 'a&b=c#d?e'));
      expect(url.protocol).toBe('https:');
      expect([...url.searchParams.values()]).toEqual(['a&b=c#d?e']);
      expect(url.hash).toBe('');
    },
  );

  it('android: спецсимволы экранированы', () => {
    const url = directionsUrlFor('android', 'a&b=c#d?e');
    expect(url).toBe('geo:0,0?q=a%26b%3Dc%23d%3Fe');
  });
});
