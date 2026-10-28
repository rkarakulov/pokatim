import { BYPASS_HTTP_CACHE } from './http-cache';

it('web: перезапрос после расхождения снимков идёт в обход кэша браузера', () => {
  expect(BYPASS_HTTP_CACHE).toBe(true);
});
