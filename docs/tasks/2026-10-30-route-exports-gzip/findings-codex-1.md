# Findings — route-exports-gzip — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..0dda874d
verdict: APPROVE

### [MEDIUM] Перезапись Vary удаляет Origin, установленный CORS

- **file:** apps/api/src/modules/routes/routes-public.controller.ts
- **location:** 132, `sendExport`
- **problem:** `setHeader(reply, 'Vary', 'Accept-Encoding')` заменяет существующий `Vary: Origin`, который устанавливает CORS при непустом `CORS_ORIGINS`.
- **why_it_matters:** Ответ имеет `Cache-Control: public, max-age=60` и зависит от Origin. Кэш может повторно использовать ответ с чужим `Access-Control-Allow-Origin`, из-за чего браузер заблокирует скачивание через `fetch` с другого разрешённого origin.
- **evidence:** `configureHttp` в `apps/api/src/http-app.ts` передаёт массив `env.CORS_ORIGINS` в `enableCors`. Установленный `@fastify/cors` добавляет `Vary: Origin` в `onRequest`; `FastifyAdapter.setHeader` вызывает заменяющий `reply.header`. Воспроизведение на установленных Fastify/CORS дало `vary: "Accept-Encoding"` при `access-control-allow-origin: "https://one.example"`.
- **recommended_fix:** Добавлять `Accept-Encoding` к существующему `Vary`, сохраняя остальные значения и `*`. Добавить HTTP-тест с включённым CORS, проверяющий наличие одновременно `Origin` и `Accept-Encoding`.

Остальные измерения контракта проверены по diff и вызовам; дополнительных подтверждённых замечаний нет. UI не затронут.

**NOT VERIFIED:** unit-тесты не запустились: Vitest получил `EPERM` при записи временного конфига в среде только для чтения. `pnpm check` и интеграционные тесты независимо не подтверждены.