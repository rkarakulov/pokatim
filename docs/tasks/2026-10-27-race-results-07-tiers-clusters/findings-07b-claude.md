# Findings — race-results-07 (07b, панель «Протокол») — pass 1 — reviewer: claude
base: feature/race-results-07   commits: feature/race-results-07..e9ca3ce (cc348aa, 5f55f68, e9ca3ce)
verdict: APPROVE

Тесты и `pnpm check` не запускались (по заданию); вывод — по чтению diff, вызовов и сервера 07a.

Проверено без замечаний: ключ запроса «Участников» включает `group`/`attention`, фильтры — на сервере, префикс
`[...raceItemKey, 'standings']` сохранён (инвалидация `raceItemKey` после действий накрывает все варианты);
`groups` сервер отдаёт полным набором независимо от фильтра (`results-panel-read.service.ts` `standingItems`), вкладки
стабильны; `keepPreviousData` + `isPlaceholderData` → скелетон таблиц при смене фильтра, при ошибке — `ErrorState` с
повтором, вкладки из state; логика `ChipGroup` как одиночного выбора корректна для всех переходов; кнопка «Пол и год» —
только при `profiles.verified_edit` (тест на moderator); вес/рост/FTP не запрашиваются (контракт
`PanelVerifiedDemographics` их не содержит); PATCH — только изменённые поля, тело проверяется
`UpdateVerifiedDemographicsRequest` до отправки; 404 GET без ретраев (глобальный `retry` — только сеть/5xx); CSS — только
переменные (`--space-s1`), без hex/px; i18n — все строки в `ru.ts`; флаги — только в панели.

### [MEDIUM] Esc закрывает окно «Пол и год» во время сохранения
- **file:** apps/admin/src/features/results/VerifiedDemographicsDialog.tsx
- **location:** `VerifiedDemographicsDialog` — `<Dialog … onClose={onClose}>`; `DemographicsForm.close`
- **problem:** защита `if (!save.isPending)` стоит только на кнопке «Отмена». `Dialog` вызывает `onClose` по Esc
  (`onCancel`/`onKeyDown`) напрямую, поэтому во время PATCH окно закрывается и форма размонтируется. Ошибка 409/403/429
  после этого нигде не показывается, а успех никто не подтверждает.
- **why_it_matters:** если сохранение не прошло, сотрудник об этом не узнает: ошибка мутации не видна (§4.12,
  «мутации — состояние кнопки»). `ReasonDialog` такой случай закрывает (`close` с `if (busy) return` передан в `Dialog`).
- **evidence:** `ReasonDialog.tsx`: `<Dialog open={open} title={title} onClose={close}>`, где `close` проверяет `busy`.
  В новом окне `Dialog` получает необёрнутый `onClose`.
- **recommended_fix:** поднять состояние «идёт сохранение» на уровень окна (или передать мутацию / флаг `pending`
  наверх) и подать в `Dialog` защищённый `onClose`. Добавить тест «Esc во время PATCH — окно открыто».

### [MEDIUM] Нет предупреждения не писать значения пола и года в причину (журнал «без значений»)
- **file:** apps/admin/src/features/results/VerifiedDemographicsDialog.tsx; packages/i18n/src/ru.ts
- **location:** `admin.results.demographics.consequences`; поле `TextAreaField` причины
- **problem:** причина свободным текстом уходит в append-only `panel_audit`. При этом правило требует, чтобы значения
  анкеты в журнал не попадали (`changedFields` без значений). Естественная причина — «райдер прислал документ, год
  1979», то есть значение в журнале. Похожий случай profile-02 (имя в причине сброса) закрыт предупреждением в окне
  (D11). Здесь предупреждения нет, а пример `REASON` в тесте («…документ с годом») ведёт именно к такому тексту.
- **why_it_matters:** нарушается намерение `.claude/rules/pokatim-security.md`, «Анкета Verified и флаги»: «Значения
  анкеты не пишутся в логи, outbox и журнал». Журнал append-only, исправить запись потом нельзя.
- **evidence:** `pokatim-security.md`, «Сброс имени райдера»: «Причина может содержать имя (D11) — предупреждение в
  окне сброса». Для пола и года аналога нет.
- **recommended_fix:** добавить в `consequences` или в подсказку поля причины текст «Не указывайте в причине пол и год —
  в журнал пишутся только названия полей». Вариант — отдельный ключ i18n в `help` у `TextAreaField`.

### [MEDIUM] «Сохранить» неактивна через нативный `disabled`, причина недоступна с клавиатуры и озвучивается не всегда
- **file:** apps/admin/src/features/results/VerifiedDemographicsDialog.tsx
- **location:** `DemographicsForm`, кнопка `Сохранить` (`disabled={!ready}`, `aria-describedby={blocked ? … }`)
- **problem:** кнопка выключается нативным `disabled` и уходит из порядка фокуса, поэтому `aria-describedby` →
  `DisabledReason` экранный диктор не прочитает. Причина выводится только для «без изменений». Нет причины, если
  отсутствует текст причины или год неверный (для года есть ошибка под полем, для причины — ничего).
- **why_it_matters:** правило панели: «причина недоступности — `DisabledReason` под кнопкой (`aria-disabled` +
  `aria-describedby`)». Так сделано в `DecisionPanel` и `PublishBlock`. `web.md` требует доступности с клавиатуры.
- **evidence:** `layout-parts.tsx` `DisabledReason`: «кнопка — `aria-disabled="true"` (остаётся в порядке фокуса)…
  нажатие такой кнопки обработчик игнорирует». `DecisionPanel.tsx:110` — `aria-disabled={reason ? true : undefined}`.
- **recommended_fix:** заменить `disabled` на `aria-disabled` (`onClick` уже проверяет `!ready`). Причины выводить
  списком: «Измените пол или год», «Укажите причину (от N символов)». Тесты переписать с атрибута `disabled` на
  `aria-disabled`.

### [LOW] Отступление от «Формы — react-hook-form + zod» не отражено в правиле
- **file:** .claude/rules/pokatim-web.md
- **location:** строка «Формы — react-hook-form + zod … Исключение — панель решения спора»; новый абзац «Группы и флаги»
- **problem:** task.md §12.2 объявляет `useState` в `VerifiedDemographicsDialog` отступлением. Правило по-прежнему
  называет единственным исключением панель решения спора, а новый абзац об этом не говорит.
- **why_it_matters:** Documentation Sync: следующий ревьюер найдёт формальное нарушение правила, а следующий автор не
  узнает, что исключение согласовано.
- **recommended_fix:** дописать в список исключений «окно пола и года (`VerifiedDemographicsDialog`, тело проверяет
  `UpdateVerifiedDemographicsRequest`)».

### [LOW] Баннер «показаны первые N» при смене фильтра берёт N из прежнего ответа
- **file:** apps/admin/src/features/results/StandingsTable.tsx
- **location:** `standings.data?.truncated ? <Banner>…count: standings.data.items.length…`
- **problem:** пока идёт загрузка с `keepPreviousData`, таблица — скелетон, а баннер о пределе остаётся от прежнего
  фильтра со старым числом.
- **why_it_matters:** косметика: число на мгновение не совпадает с тем, что загружается.
- **recommended_fix:** скрывать баннер при `standings.isPlaceholderData`.
