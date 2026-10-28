/**
 * Обход HTTP-кэша (`public, max-age=60`) при перезапросе таблицы после расхождения снимков (ревью 08c pass 1).
 * Native — выключен: `fetch` React Native — это `whatwg-fetch`, который при `cache: 'no-cache'` дописывает `_=<время>`
 * в URL, а query таблицы сезона строгий (`strictObject` — лишний ключ 400). Перезапрос идёт обычным GET (ограничение —
 * §12.3 follow-ups). Web — `http-cache.web.ts`.
 */
export const BYPASS_HTTP_CACHE = false;
