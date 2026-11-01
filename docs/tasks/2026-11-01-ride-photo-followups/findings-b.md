# Findings — ride-photo-followups (PR B) — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..07531566 (4538cbbc, 3789b362, f02fc725, 25b76a6f, 3913ddce, merge 07531566)
verdict: APPROVE

### [LOW] Правило контрактов всё ещё обещает `ridePhotoUrl` в админском клиенте
- **file:** .claude/rules/pokatim-contracts.md
- **location:** строка 297 («admin — `resetRidePhoto(id, body)`, `ridePhotoUrl`»)
- **problem:** PR B удалил `ridePhotoUrl` из `createAdminApiClient` (`packages/api-client/src/admin.ts`), а правило
  контрактов по-прежнему перечисляет его среди методов админского клиента.
- **why_it_matters:** Documentation Sync (task.md §10 перечисляет `pokatim-contracts.md`). Следующая сессия по правилу
  будет искать или заново добавлять публичный адрес в панель, хотя R11 b прямо требует только админский
  `moderationRidePhotoUrl` (у скрытого публичный отдаёт 404).
- **evidence:** `git grep -n ridePhotoUrl -- .claude/rules` → `pokatim-contracts.md:297: … admin — resetRidePhoto(id, body), ridePhotoUrl.`;
  в diff `admin.ts` строка `ridePhotoUrl: (id: string) => …` удалена.
- **recommended_fix:** в `pokatim-contracts.md:297` оставить у admin только `resetRidePhoto(id, body)` и
  `moderationRidePhotoUrl(rideId, photoId)`; можно добавить «публичного `ridePhotoUrl` в админском клиенте нет
  (ride-photo-followups PR B)».
- **fixed:** `pokatim-contracts.md` — у admin оставлен только `resetRidePhoto(id, body)` (`moderationRidePhotoUrl` — в той же
  строке ниже, ride-photo-followups); упоминание `ridePhotoUrl` у приложения сохранено.

## Проверено без замечаний

- **correctness / AC1.** `ride-detail.tsx:168` — `photo={ride.photo ? api.ridePhotoUrl(ride.photo.id) : null}`, как в
  `ride-hero.tsx:42`. Скрытый: сервер отдаёт `photo: null` (`ridePhotoOf` в `rides-feed.service.ts:83`: `status !==
  'hidden'`) — типографская шапка. Ошибка картинки — `SectionHero.failedPhoto` по адресу; смена фото (новый id → новый
  адрес) сбрасывает отказ, удаление организатором (`RidePhotoDelete`) → `photo: null` → типографская.
- **SSR / гидрация.** `rides/[id].tsx` сеет `RideDetail` через `loader`; адрес строится из `EXPO_PUBLIC_API_URL` и на
  сервере (чтение при запросе), и в клиенте (подстановка при сборке), с одинаковой обрезкой `/` — разметка совпадает,
  если env процесса `start:web` и сборки равны (то же требование уже есть для всех API-вызовов). expo-image web на SSR
  рендерит обычный `<img src>` (`ImageWrapper.js`, без `headers` нет fetch в эффекте). Не проверено: если `error`
  картинки случится до гидрации, React-обработчик `onError` может его не получить, и фото не сменится на типографскую
  шапку. Последствие мягкое: битый `<img alt="">` браузер не рисует, остаются скрим поверх `surface.raised` и текст
  `onPhoto`, читаемо. Поэтому не находка: закрывается визуальной проверкой web из `NOT VERIFIED` в pr-b.md.
  **Позже (fix pass):** Codex прав — серверный `renderToString` на `expo-image` web `<img>` не даёт (см.
  `findings-b-codex.md` HIGH, fixed); ошибка до гидрации тоже обработана.
- **Все платформы.** Развилок нет: `SectionHero` / `PhotoScrim` общие для native и web, web-тест
  `section-hero.web.test.tsx` (пустой alt, `aria-hidden` у скрима) не менялся и зелёный.
- **a11y / контраст.** Фото декоративное (`accessible={false}`, `accessibilityLabel=""`), один доступный элемент
  героя; скрим — профиль `photoScrimHero` без новых значений (контраст покрыт тестом токенов).
- **Панель / AC6.** `RidePhoto` — одна ветка для любого статуса: `PhotoImage key={photo.id}`,
  `src=moderationRidePhotoUrl(ride.id, photo.id)` (относительный `''` + `/v1/admin/rides/:id/photo?photoId=`, тот же
  origin, cookie сессии, `img-src 'self'` — CSP не менялся). Смена `photo.id` перемонтирует (скелетон, сброс ошибки),
  hide/restore с тем же фото — нет, и это правильно: админская отдача работает для любого статуса. «Повторить»
  перемонтирует `<img>` (`key={attempt}`), а ответ `private, no-store` не залипает в кэше. Пометка `photoHidden`
  остаётся и при ошибке картинки (тест). Класс `ride-photo-preview--hidden` по-прежнему нужен плашке ошибки.
- **Удаление `ridePhotoUrl` из админского клиента.** `git grep` — в `apps/admin` больше нет вызовов, тест api-client
  обновлён, `tsc --noEmit` у admin и app — 0 ошибок.
- **i18n.** Ключ `photoHidden` переписан на месте, других потребителей нет.
- **Тесты.** `ride-detail.test.tsx` (гость, вошедший с `error`, скрытый), `notifications.test.tsx`
  (`ride_photo_reset` → `/rides/<id>`), `RideModerationScreen.test.tsx` (видимый/скрытый, ошибка у скрытого, смена
  `photo.id`, 409) — проверяют поведение, а не реализацию. Прогнал сам: app jest 4 suites / 125 passed; admin vitest 3
  files / 30 passed; api-client `ride-photo.test.ts` 6 passed; prettier и eslint по изменённым файлам чисто.
- **Доки.** `rides.md`, `admin-panel.md`, ADR-0028 «Последствия», `pokatim-app.md`, `pokatim-web.md` соответствуют
  коду (кроме LOW выше). API, миграций, очередей, аудита изменение не трогает.
