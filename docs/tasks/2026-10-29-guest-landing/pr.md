## Гостевой лендинг «Покатим» (guest-landing)

Новый гость (без сессии, на устройстве ещё не входил) вместо «Регистрации» видит лендинг `/welcome`: что это за
сервис, живые публичные данные и «Зарегистрироваться» / «Войти». На web — HTML с сервера, мета и OG, страница
индексируется. Решения автора G1–G6, архитектора RC-1…RC-12 и отклонения — `task.md` (§3, §8.1, §8.2).

### Что изменено

- `apps/app/src/app/welcome.tsx` — корневой экран в `Stack.Protected guard={!signedIn}` рядом с `(onboarding)`;
  вошедший уходит на `/`. Экран — `apps/app/src/features/landing/`: герой, «Гонки по маршруту» (ближайшая гонка),
  «Сезон» (текущий), «Кофе-райды» (только текст), «Маршруты» (до 3 маршрутов команды, `author=team`), «Календарь
  стартов» (ближайший старт), нижний призыв.
- Гард вкладок (`_layout.tsx`): новый гость → `/welcome`, `returning` → `/sign-in`, живая регистрация → `/register`
  (с лендинга — тоже, если стор регистрации пришёл позже гарда).
- SSR: `loader` из четырёх публичных списков (`fetchPublicForSsr`, части `null`, не бросает), посев — `initialData`
  хуков Главной и `useLandingRoutes`; `generateMetadata` — `landingMetadata` (`og:url` `/welcome`, без `robots`),
  она же — мета `/`. Подписи «сегодня / завтра» — после монтирования (`now: Date | null` у `RaceHero`,
  `CalendarStartHero`), без `useId`.
- Живые блоки (`LandingSection`): скелетон на первой загрузке; пусто — текст пустого состояния; ошибка и офлайн без
  данных — блок скрыт без повтора (отступление от §4.12, решение автора G5).
- `SeasonLinkRow` вынесен из `season-detail.tsx` в `features/races/season-row.tsx`; `useCurrentSeason`.
- `packages/i18n` — `landing.*`. API, контракты, api-client — без изменений.
- Тесты: `landing.test.tsx`, `heroes.test.tsx`, мета и loader в `public-metadata.test.ts`, сторож SSR-манифеста
  (`/welcome`), гостевые тесты и web-смоук переведены с `/register` на `/welcome`.
- Документы: `docs/product/landing.md` (новый), `docs/product/home.md` (Q5), `docs/product/README.md`,
  `.claude/rules/pokatim-app.md`.

### Миграции, env, конфиги

Нет.

### Проверки

- `pnpm format:check && pnpm lint && pnpm arch:check` — зелёные; `pnpm --filter @pokatim/app typecheck` — 0;
  `pnpm --filter @pokatim/app test` — 212 suites, 1962 tests passed; `pnpm --filter @pokatim/i18n test` — 14 passed.
- Web-смоук локально без API: новые шаги (`/`, HTML и мета `/welcome`, «Войти») прошли; 5 падений «гард входа без
  API» на экранах вне diff (ждут «Нет соединения», видят «Не удалось загрузить»; в CI ветка без API не исполняется).
  Смоук с API — CI.
- Независимое ревью: pass 1 APPROVE (MEDIUM исправлен, LOW оставлен как у остальных экранов), pass 2 APPROVE (`findings.md`).
- `NOT VERIFIED`: iOS/Android вживую; 375 px, светлая/тёмная — на dev после мержа.

### Follow-ups

- `robots.txt`, sitemap, OG-картинка лендинга.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
