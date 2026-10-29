# Findings — web-push PR A — pass 1 — reviewer: claude (independent-reviewer)

Вердикт: **APPROVE**. CRITICAL/HIGH — нет.

| # | Уровень | Находка | Решение |
|---|---|---|---|
| 1 | MEDIUM | Сбой Expo (`send` бросает) прерывает доставку до Web Push: пользователь с телефоном и PWA не получает push, пока Expo недоступен | Исправлено: ошибка Expo запоминается, web отправляется; ретрай — только если не принял никто (`push-delivery.ts`) |
| 2 | MEDIUM | Нет тестов доставки при обоих включённых транспортах | Исправлено: `web-push-expo.int.test.ts` — 5 сценариев (оба приняли, сбой Expo, сбой web, оба недоступны → ретрай, `DeviceNotRegistered` + 410) |
| 3 | LOW | Экранирование JSON может раздуть тело сверх лимита → код `bad_keys` | Исправлено: `encodePayload` укорачивает текст по байтам; `RangeError` — `payload_too_large` |
| 4 | LOW | Постоянно непригодные подписки (битый ключ) не снимаются | Исправлено: `ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY` → `gone` (прочие ошибки шифрования подписку не трогают); сверка `applicationServerKey` на клиенте — D8, PR B |
| 5 | LOW | `redirect: 'manual'` против `'error'` в спеке | Спека поправлена: редирект не исполняется, 3xx → `protocol` (тест 301 есть) |
| 6 | LOW | Матрица §5 указывает не те файлы тестов | Матрица обновлена |
