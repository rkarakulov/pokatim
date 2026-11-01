# Findings — routes-leftovers-review — pass 1 — reviewer: claude (fallback, самопроверка автора)

base: origin/develop   commits: origin/develop..HEAD
verdict: APPROVE (не кросс-движковое и не независимое)

Codex недоступен: `codex exec` — «spend cap» рабочего пространства (`codex_review.sh` exit 4). Свежий
`independent-reviewer` исполнитель (форк без субагентов) запустить не может — ревью выполнено автором по контракту.

Проверено:

- `MyRouteEdit` у экрана: переход «Обрабатывается → готов» (тест), заморожено — подпись вместо формы (тест), отмена и
  успех снимают черновик; ошибка валидации под полем — локальна форме и при смене раскладки сбрасывается (LOW, принято).
- `KeyboardAvoidingArea`: iOS и Android — `padding` и `keyboardVerticalOffset = -insets.bottom` (тесты обеих
  платформ на событиях `keyboardWillShow` / `keyboardDidShow`); web — `View`. Расчёт RN: `frame.y + frame.height −
  (screenY − offset)`.
- Курсор уборщика: полная пачка — `set` с TTL; неполная — выход, `del`; предел пачек — курсор уже записан; пустой скан
  после полной пачки — `del`. Тест сбоя посреди прогона.
- Ключи i18n: `git grep` — без потребителей, динамических ключей `routes.detail.${…}` нет.

LOW (follow-up, вне scope): `features/auth/auth-screen.tsx` — `KeyboardAvoidingView` без поведения на Android (тот же
edge-to-edge), можно перевести на `KeyboardAvoidingArea`.

NOT VERIFIED: клавиатура на устройствах (iOS, Android edge-to-edge) — значения `keyboardDidShow` на Android не
проверены вживую.
