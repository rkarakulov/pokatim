# Findings — race-results-06-disputes — pass 1 — reviewer: claude
base: origin/develop (merge-base e047921)   commits: e047921..66135ce (9 коммитов, рабочее дерево чистое)
verdict: APPROVE

Проверено руками: диф целиком (API `disputes`, правки `results`/`races`/`panel`, миграция 0018, контракты,
api-client, i18n, приложение, панель, docs), вызовы вне дифа (`syncGroup`, `setRequests`, `rankedFilter`,
`summaryOf`, `lockEntry`/`lockResults`, частичный уникальный индекс `race_recalculations_revision_unique` —
`$type: 'number'`, поэтому записи `revision: null` не конфликтуют).

Запущено:
- `tsc --noEmit` для api, app, admin, contracts — зелёный;
- vitest api (unit): `disputes.policy`, `disputes.repository` (сторож), `results.policy`, `races.policy` — 76/76;
- jest app: `race-disputes`, `features/races/disputes`, `race-participation` — 80/80;
- vitest admin: `features/disputes`, `RaceResultsScreen` — 38/38.

NOT VERIFIED:
- int-тесты API (`disputes*.int`, `disputes-locks.int`, `results-disputes.int`, `races-admin.int`, `migrations.int`):
  Docker-демон не запущен, MongoDB/Redis недоступны. Код отрицательных доказательств AC10 прочитан: механика
  (`gate`/`untilBlocked`, подмена замка чтением) честная, проверяется итоговое состояние, а не таймаут.
- `pnpm e2e:admin`, ручной смоук приложения на web, iOS и Android (как и в §12 task.md).

Сводка по измерениям. Замечаний нет:
- Замки: подача — `lockResults` → `lockEntry` цели; решение — `lockResults` → `lockEntry` → `decide` с фильтром
  `status: 'open'`; D-39 под `lockEntry`/`lockEntryOf`; D-19 — конфликт записи документа гонки.
- D-51: `againstMeView` и `myDisputeView` — явные списки полей; outbox и `dispute_events` — только id и коды; логи без
  текста и `userId`.
- AuthZ: чужая сторона — 404 (DV-6); права на каждом методе панели; organizer прав на споры не получил.
- Append-only: сторож по исходнику плюс unit на фильтры переходов.
- DQ до публикации: `rankedFilter` + `protocolBaseEntries` + журнал `revision: null` (сортировка ставит null
  первыми).
- Миграция: expand-only и идемпотентна.
- Контракты: в ответах приложения `tolerantEnum`; i18n-ключи `*.unknown` есть.
- UI: только компоненты систем `@rkarakulov/ui` и `src/ui`, без литералов и сырых цветов.
- Состояния: скелетон, ошибка с повтором, пусто.
- Docs §10 синхронизированы.

### [MEDIUM] D-39 даёт сопернику заморозить загрузки цели на всё оставшееся окно гонки
- **file:** apps/api/src/modules/disputes/disputes.policy.ts
- **location:** `fileBlock` (стр. 46–62); вместе с `entryDisputeBlock` в `attempts.service.ts:105–110` и `attempt-intake.ts:113–119`
- **problem:** подачу не ограничивает фаза гонки, нужен только засчитанный результат заявителя. Поэтому спор можно подать
  в фазе `open`, в первый день окна. С этого момента цель не может загрузить новый заезд (D-39). Авто-импорт её
  устройств тоже заморожен, и после решения или отзыва он сам не возобновится (RC-5/R5). Решение возможно не раньше
  чем через 12 ч, а на деле — когда до спора дойдёт команда. Отозвать спор заявитель может в любой момент.
- **why_it_matters:** это вектор злоупотребления, которого нет в §8.3 «Злоупотребления» и в R5. Райдер с засчитанным
  результатом подаёт спор с категорией `other` без описания против лидера и лишает его возможности улучшить время в
  открытом окне. Затем отзывает спор, а авто-попытки лидера по замороженной группе так и не появятся. Лимит 3
  открытых и «один спор на пару» масштаб ограничивают, но не снимают проблему для конкретной цели.
- **evidence:** `fileBlock` проверяет `cancelled`, `protocol_published`, заявителя и `filing_closed`, фазу окна —
  нет. `syncGroup`: `if (!requested && (await this.disputes.openAgainst(entry._id, tx)) > 0) return;`. task.md R5 и
  RC-5 принимают потерю авто-импорта, сценарий подачи до конца окна не обсуждается.
- **recommended_fix:** решение продукта, вне кода ревью. Варианты: (a) принимать споры только после `closesAt` окна
  (фаза `closed`); (b) в фазе `open` D-39 закрывает только «Отменить участие», а не загрузку; (c) явно принять риск
  записью в §8.1/§8.3 и в ADR-0012. Если выбран (a), добавить причину в `DISPUTE_FILE_BLOCKS` (в конец) и
  unit-тест политики.

### [LOW] Ссылка «Решение по спору ·xxxxxx» в истории пересчётов не учитывает право `disputes.read`
- **file:** apps/admin/src/features/results/RecalculationsList.tsx
- **location:** колонка `reason`, ветка `dispute:` (стр. ~46–60)
- **problem:** ссылку на `/disputes/<id>` видят все, у кого есть раздел «Результаты». Это и organizer (`results.manage`),
  у которого прав на споры нет (R1): переход ведёт на «Нет доступа». В `PublishBlock` такая же ссылка закрыта
  `useCan('disputes.read')`.
- **why_it_matters:** непоследовательный UX и тупиковый переход у организатора. Данные не утекают: сервер отвечает 403.
- **evidence:** в `RecalculationsList.tsx` нет `useCan`; в `PublishBlock.tsx` —
  `check.code === 'open_disputes' && check.count > 0 && canReadDisputes`.
- **recommended_fix:** без `disputes.read` показывать текст `admin.results.recalc.disputeReason` без `Link`. Добавить
  RTL-кейс с `ME.organizer`.

### [LOW] Кнопка решения не становится активной в момент `decidableAt` без перезапроса
- **file:** apps/admin/src/features/disputes/DecisionPanel.tsx
- **location:** `serverBlock = dispute.decideBlockedBy` (стр. ~44–49)
- **problem:** `too_early` — снимок сервера на момент чтения. Если разбор открыт до `filedAt + 12 ч`, после наступления
  срока кнопка остаётся `aria-disabled` с причиной «не раньше {дата}», пока запрос не обновится (фокус окна или
  перезагрузка).
- **why_it_matters:** мелкий UX §4.12: модератор видит прошедшую дату как причину блокировки. Корректность не
  страдает: сервер проверяет D-25 сам.
- **evidence:** `decideBlockText(serverBlock, dispute.decidableAt)`; ни таймера, ни `refetchInterval`, ни сравнения с
  текущим временем в компоненте нет.
- **recommended_fix:** для `too_early` поставить у `disputeQuery` `refetchInterval` или таймер до `decidableAt`. Либо
  считать на клиенте «блок только пока `now < decidableAt`»; окончательный отказ всё равно даёт 409 сервера.

Блокирующих (CRITICAL/HIGH) нет.

## Разбор автора (pass 1)

- **MEDIUM (споры в открытом окне)** — принятый риск, без правки. Прототип прямо показывает D-39 при открытом окне
  («Окно открыто, но по своему результату открыт спор»): подача спора в окне — продуктовое решение. Смягчение —
  один спор на пару без повтора после отзыва (R2), ≤ 3 открытых на заявителя, лимит подачи, решение через 12 ч;
  злоупотребление видно команде в разборе. Записано в task.md §8.2 DV-26; пересмотр — по данным эксплуатации.
- **LOW (ссылка на спор в истории пересчётов без права)** — исправлено: `RecalculationsList` даёт ссылку только с
  `disputes.read`, иначе текст; RTL — случай организатора в `RaceResultsScreen.test.tsx`.
- **LOW (кнопка решения после `decidableAt`)** — принято: сервер проверяет D-25, запрос разбора обновляется при
  фокусе окна; таймер — не в этом слайсе.
