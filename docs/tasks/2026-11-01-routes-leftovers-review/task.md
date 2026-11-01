# routes-leftovers-review — правки по ревью Claude после merge #198, #193, #200

Уровень: task2. Ветка `fix/routes-leftovers-review` от `origin/develop`.

## Scope

#198 («Мой маршрут», routes-07):

1. [MEDIUM] Правка — у экрана (`MyRouteEdit`: черновик названия, открытое подтверждение удаления): опрос
   «Обрабатывается → готов» меняет раскладку, правка остаётся.
2. [MEDIUM] Android edge-to-edge (Expo 58, RN 0.88): окно под клавиатуру не ужимается — `KeyboardAvoidingArea` на iOS и
   Android `behavior="padding"` (RN `KeyboardAvoidingView` на Android слушает `keyboardDidShow`); web —
   `keyboard-avoiding-area.web.tsx` (`View`). Отдельный `.android.tsx` не нужен: поведение iOS и Android одинаковое.
3. [LOW] Зазор над клавиатурой: `keyboardVerticalOffset = -insets.bottom` (нижний inset держит шторка).
4. [LOW] Заморожено (A3) — формы нет, подпись; готовый без длины — «Мои заезды» в раскладке без карты.
5. [LOW] Неиспользуемые ключи `routes.detail.{length,elevation,elevationValue,loop,yes,no}` удалены (`git grep`).
6. [LOW] `routes.md` M4 — по routes-07; тест клавиатуры эмулирует `keyboardWillShow` (отступ > 0); тест routes-04c
   (тавтология) удалён.

#193 / #200 (route-rides-07 удаление, route-rides-08 уборщик):

7. `routes.md`: удаление опубликованного маршрута райдера (автором или с аккаунтом) — заезды всех райдеров удаляет
   уборщик в течение суток.
8. `pokatim-db.md`, `route-rides-07-delete/task.md` §8 — принятый риск: ручной заезд, удалённый до первого
   `saveAutoPlan`, может вернуться автозаездом.
9. Уборщик: курсор в Redis после каждой полной пачки (сбой посреди прогона продолжается с неё); int-тесты — сбой
   посреди прогона, скрытый модератором маршрут не трогается, основная удалена при живом дубле.

## Acceptance

- Тесты app (`my-routes`, `keyboard-avoiding-area`), api (`route-rides-orphans.int`), i18n — зелёные; typecheck, lint.
- Устройства (iOS, Android edge-to-edge) — NOT VERIFIED.
