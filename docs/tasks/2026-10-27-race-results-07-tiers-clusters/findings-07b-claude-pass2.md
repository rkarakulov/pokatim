# Findings — race-results-07b — pass 2 — reviewer: claude
base: origin/develop   commits: origin/develop..cb6c9f1 (cc348aa, 5f55f68, e9ca3ce, 8621b75, cb6c9f1)
verdict: APPROVE

Тесты и `pnpm check` не запускались (по заданию) — **NOT VERIFIED**: зелёный прогон из task.md («Фиксы ревью 07b
pass 1»: api 1334, admin 304, `exit=0`) не подтверждён. Вывод сделан по чтению diff, вызовов и серверного кода.

## Закрытие находок pass 1

- [HIGH codex] Финишёры за пределом — **закрыто.** `PanelRaceStandingsQuery.finishers` (`z.enum(['true']).optional()`
  в `z.strictObject`, тот же `ZodValidationPipe` и `@RequirePermission('races.read')` в контроллере). Фильтр
  срабатывает до предела в двух местах. В репозитории `standingsFilter`: `status: 'active', 'best.ranked': false`,
  что совпадает с `unrankedOf` (`best.ranked === false`). В сервисе при `finishers` `headRows = []`, поэтому строки с
  местом не занимают лимит. Строки из `rest` проходят проверку `unranked !== null`, а `overflow` считается по
  отфильтрованному набору. Комбинации с `group`/`attention` корректны. Int-тест «1000 ранжированных + START» проверяет
  `truncated: false` и START в ответе. Панель: отдельный `useQuery` с `enabled: finishersTotal > 0`. В ключе есть
  `finishers`, префикс `[...raceItemKey, 'standings']` сохранён, поэтому инвалидация накрывает оба запроса. Пустое
  состояние берётся только из ответа этого запроса, у блока свой баннер предела.
  Совместимость: параметр необязательный, эндпоинт только панельный, мобильных клиентов нет.
- [HIGH codex] Ошибка фонового обновления анкеты — **закрыто.** Ветка `current.data`: при `isError` над формой
  показывается баннер с `refetch`, форма и введённое остаются. Есть тест.
- [MEDIUM codex] Подпись `HR_POWER_DECOUPLED` — **закрыто**, теперь нейтральное «Расхождение {value} %».
- [MEDIUM claude] Esc во время PATCH — **закрыто.** В `mutationKey` + `useIsMutating` окно получает защищённый
  `onClose`, «Отмена» проверяет `save.isPending`. После успеха `onClose` вызывается без защиты, и окно закрывается.
  Тест проверяет `keyDown Escape` и `cancel`.
- [MEDIUM claude] Значения в причине — **закрыто**: `help` у `TextAreaField` (`reasonHelp`) связан через
  `aria-describedby`. Пример `REASON` в тесте исправлен.
- [MEDIUM claude] `aria-disabled` + `DisabledReason` — **закрыто.** Причины перечислены списком («Измените…»,
  «Исправьте год…», «Укажите причину — от N символов»). Клик по неактивной кнопке игнорируется, есть тест.
- [LOW claude] Исключение `useState` в `pokatim-web.md` — **закрыто**.
- [LOW claude] Баннер предела при `isPlaceholderData` — **закрыто** для обоих блоков.

Регрессий не найдено. Таблица «Участники» по-прежнему берёт `unranked === null` из основного ответа. Вкладки групп
и `keepPreviousData` не изменились. Documentation Sync: `pokatim-web.md`, `pokatim-backend.md` и task.md (раздел
фиксов) соответствуют diff.

### [LOW] Форма не подхватывает новые значения после фонового обновления, PATCH может откатить чужую правку
- **file:** apps/admin/src/features/results/VerifiedDemographicsDialog.tsx
- **location:** `DemographicsForm`: `useState(current.gender)` / `useState(String(current.birthYear))`; `changed`;
  `DemographicsBody` (`key={userId}`)
- **problem:** `verifiedDemographicsQuery` использует `staleTime: 0`, поэтому при фокусе окна или переподключении
  данные обновляются. Поля формы инициализируются один раз, а `changed` и тело PATCH сравниваются уже с новым
  `current`. Если другой сотрудник поменял год с 1981 на 1985, в поле остаётся 1981. Тогда `changed = true`, и
  «Сохранить» отправит `birthYear: 1981`: молча откатит чужую правку, хотя пользователь год не трогал.
- **why_it_matters:** гонка двух сотрудников с `profiles.verified_edit` маловероятна. Но значение анкеты Verified
  влияет на группу, а интерфейс показывает «изменение», которого пользователь не делал.
- **evidence:** `const [year, setYear] = useState(String(current.birthYear))`; `changed = gender !== current.gender ||
  (… parsedYear.data !== current.birthYear)`; `<DemographicsForm key={userId} …>`.
- **recommended_fix:** включать в `key` формы значения `current` (`${userId}:${current.gender}:${current.birthYear}`)
  или отключить `refetchOnWindowFocus` / `refetchOnReconnect` для этого запроса, пока окно открыто. Не блокер.
