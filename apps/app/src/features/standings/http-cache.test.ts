import { BYPASS_HTTP_CACHE } from './http-cache';

it('native: обход HTTP-кэша выключен — whatwg-fetch дописал бы `_=` в строгий query таблицы (400)', () => {
  expect(BYPASS_HTTP_CACHE).toBe(false);
});
