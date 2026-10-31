# Findings — notifications-fanout — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..4e4066b1
verdict: REQUEST CHANGES

### [HIGH] Ошибки постановки пачек могут завершить intake успешно
- **file:** apps/api/src/modules/notifications/fanout-jobs.ts
- **location:** 31–41, `FanoutJobs.enqueue`
- **problem:** Успешный возврат установленного `FlowProducer.addBulk` не гарантирует постановку пачек. BullMQ игнорирует ошибки отдельных команд в ответе Redis `MULTI`, а `enqueue` безусловно возвращает число пачек.
- **why_it_matters:** При отказе Redis, например из-за ограничения памяти, intake возвращает `fanned_out` и завершается без ретрая, хотя задачи получателей отсутствуют. Уведомления теряются. При частичной постановке сохранившаяся пачка `0-0` дополнительно блокирует восстановление через `started`.
- **evidence:** В `node_modules/bullmq/dist/esm/classes/flow-producer.js:176–187` результат `[err, jobId]` обрабатывается только при `!err`; ошибка не пробрасывается. Проверка вызовом настоящего `FlowProducer.prototype.addBulk` с подменённым backend, возвращающим `[[Error("OOM…"), null]]`, подтвердила успешное разрешение Promise. После этого `notifications-intake.processor.ts:97–102` возвращает `fanned_out`. Redis production настроен с `maxmemory` и `noeviction` в `infra/deploy/docker-compose.yml`.
- **recommended_fix:** Использовать исправленную версию BullMQ с обработкой ошибок `addFlow` и обеспечить восстановление неполной постановки из исходного снимка. Сторож должен подтверждать наличие полного набора пачек. Добавить отрицательные тесты полного и частичного отказа постановки: intake не должен сообщать успех или пропускать недостающие пачки.

NOT VERIFIED — `pnpm check`, интеграционные тесты и воспроизведение отказа на реальном Redis не запускались; выполнены чтение кода и изолированная проверка обработки ошибки библиотекой.