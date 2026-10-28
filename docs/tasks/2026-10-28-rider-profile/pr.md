## Профиль райдера, PR A: API — аватар, клуб, история, статистика, публичный профиль

Спецификация — `docs/tasks/2026-10-28-rider-profile/task.md` (экран 10; в прототипах отдельного экрана нет, решения
R1–R10 — `docs/product/profile.md`). Приложение — следующим PR (B).

### Что сделано
- **Аватар** (ADR-0019):
  - `PUT /v1/profile/avatar` — тело `octet-stream` до 10 МиБ, обрезка по query `x, y, size`;
  - `POST /v1/profile/avatar/delete`;
  - `GET /v1/avatars/:id` — публичный, `immutable`, `nosniff`, `CSP sandbox`.
  - Сервер (sharp 0.35.5): сигнатура JPEG/PNG/WebP. Пределы: JPEG и WebP — 100 Мп (уменьшение при декодировании до
    2048 px), PNG — 25 Мп. Поворот по EXIF, квадрат 512 × 512, JPEG без метаданных (EXIF и GPS стёрты). Исходник не
    хранится, байты — в Mongo `profile_avatars`.
  - Слоты: чтение тела — 4 на процесс и 1 на пользователя (таймауты 10/60 с); обработка — 1 на процесс (ожидание до
    5 с, затем 429). Не больше 20 загрузок в час.
- **Клуб** — `club` в `PATCH /v1/profile` (2–60 символов, правила как у имени).
- **История:**
  - `GET /v1/profile/races` — место и статус та же функция, что «моё участие»;
  - `GET /v1/profile/rides` — прошедшие райды, где пользователь «Иду» или организатор.
- **Статистика** `GET /v1/profile/stats` — км и набор по своим заездам без дублей и `other`, гонки в зачёте, подиумы,
  лучшие места. Все чтения индексные.
- **Публичный профиль** `GET /v1/riders/:publicId` и `…/races` — только при имени и согласии на показ, иначе 404. В
  ответе нет `userId`, км, набора и райдов, курсор — без времени заезда. `publicId` — случайный токен.
- **Удаление аккаунта** стирает аватары (`ProfileErasure`).
- Новый модуль `riders`, порты `RIDER_PROFILES`, `RIDER_RESULTS`, `ACTIVITY_TOTALS`.

### Миграция, env, зависимости
- `0033_rider_profile` только добавляет данные, повторный запуск безопасен:
  - коллекция `profile_avatars` и индекс `userId`;
  - уникальный частичный `profiles.publicId`;
  - `race_entries_user_history_idx`, `race_protocol_rows_user_idx`;
  - бэкфилл `publicId` (у кого есть имя и согласие) и `race_entries.raceWindowStartsAt`.
- Новая зависимость `sharp` (`apps/api`): бинарники `@img/sharp-*` — optional, install-скриптов нет. Образ собирает
  `deploy-rehearsal`, sharp загружается при старте API.
- env не меняется.

### Ревью
- Claude independent-reviewer, проход 1: REQUEST CHANGES. HIGH — курсор публичной истории раскрывал время заезда.
  MEDIUM — память sharp против лимита 512m и медленное тело держало слот. Всё исправлено (`findings.md`).
- Проход 2: APPROVE. Два MEDIUM исправлены до PR: фото 48–100 Мп с телефона принимаются, слоты чтения и обработки
  разделены.

### Проверки
- `TURBO_CONCURRENCY=1 pnpm check` — зелёный: api 1551, app 1727 и остальные пакеты.
- NOT VERIFIED: пик памяти sharp в образе linux/amd64. Замер на macOS: JPEG 48–100 Мп ≈ +40 МБ, PNG 25 Мп ≈ +107 МБ.

### Follow-ups
- Модерация клуба и фото: сброс модератором, жалобы.
- Перевыпуск id фото при отзыве согласия (RC-A2).
- Ссылки на публичный профиль и аватары в таблицах результатов и рейтинга.
- Финишёры START в статистике.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
