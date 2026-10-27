# Findings — routes-03b-profile-smooth — pass 1 — reviewer: claude
base: origin/develop   commits: 85cadf6 (origin/develop..HEAD)
verdict: APPROVE

Вход: требование пользователя (из запроса на ревью), `pr.md` (task.md для 03b нет — ревью по pr.md, AGENTS.md,
`.claude/rules/{app,pokatim-app}.md`), diff `git diff origin/develop...HEAD`. Незакоммиченных изменений в затронутых
путях нет.

Проверено (evidence):
- `cd apps/app && pnpm exec jest elevation-profile format route-detail` — 13 suites / 227 tests passed (native и web
  проекты). `pnpm exec tsc --noEmit` — без ошибок.
- Развилка платформ: `profile-chart.tsx` (native) + `profile-chart.web.tsx`; оба импортируют только `./format` и
  `./profile-style`, самоимпорта нет. Web-тест импортирует `./profile-chart` и получает `<svg` — разрешение `.web` в
  jest-проекте `web` (jest-expo/web) подтверждено. Native-тест получает 160 столбиков `elevation-profile-bar`.
  Вызовов `PROFILE_BARS` / `elevation-profile-bar` вне `features/routes` (в т. ч. e2e) нет.
- SSR: разметка web зависит только от данных (округление до 0,1 детерминировано), без `onLayout`/эффектов/`window`;
  повторный `renderToString` идентичен.
- a11y: контейнер `elevation-profile-chart` — `accessible`, `role=image`, `accessibilityLabel=profileSummary`; обёртка
  графика — `no-hide-descendants` + `accessibilityElementsHidden`; SVG — `aria-hidden="true"`, `focusable="false"`.
- Токены: цвет — роль `map.corridor` (light neutral600 #5C5C5C, dark neutral400 #A3A3A3), толщина — `stroke.input`
  (1.5), контраст линии с `surface.default` ≥ `WCAG.ui` в обеих темах — тест. `PROFILE_FILL_OPACITY` — константа
  по прецеденту `CORRIDOR_OPACITY` (токена прозрачности нет).
- Documentation Sync: `docs/product/routes.md` и `.claude/rules/pokatim-app.md` обновлены и соответствуют коду.

### [MEDIUM] Native: «линия» — ступенчатые несвязанные кромки столбиков, на крутых участках — пунктир
- **file:** apps/app/src/features/routes/profile-chart.tsx
- **location:** 42-53 (второй слой, `borderTopWidth: stroke.input` у каждого столбика)
- **problem:** верхняя кромка на native — 160 горизонтальных отрезков шириной ≈ 2,2 pt и толщиной 1,5 pt, по одному на
  столбик. Соседние отрезки не соединены по вертикали: где перепад высоты между соседними столбиками больше 1,5 pt
  (на графике ≈ 86 pt высотой это частые случаи на подъёмах/спусках), линия распадается на «ступеньки с разрывами».
  Это ровно тот визуальный дефект, на который жаловался пользователь («как будто пикселями квадратными»); на web он
  устранён, на iOS/Android — только смягчён (столбики уже, цвет светлее).
- **why_it_matters:** требование — «плавная линия ... все платформы». Функционал на платформах одинаков (§4.13 не
  нарушен), но визуальное требование на native выполнено частично; если пользователь смотрел карточку в iOS/Android
  dev-сборке, замечание «пиксельный профиль» останется.
- **evidence:** `style={[styles.bar, { height: \`${height * 100}%\`, borderTopWidth: stroke.input, borderTopColor: color }]}`
  — кромка каждого `View` независима; pr.md, «NOT VERIFIED»: «Вид на устройстве iOS/Android ... вручную», follow-up —
  react-native-svg вместе с routes-04.
- **recommended_fix:** явно согласовать с пользователем, что native-плавность — follow-up routes-04 (react-native-svg
  в новой dev-сборке), и проверить вид на устройстве до закрытия замечания. Если нужно сейчас без новой зависимости —
  убрать кромку (оставить только светлую заливку) либо сделать кромку столбика высотой не меньше перепада до соседа
  (вертикальный «зазор» закрывается), но настоящий фикс — SVG-путь и на native.

### [LOW] Native-тест не проверяет новый внешний вид (цвет, прозрачность заливки, кромку)
- **file:** apps/app/src/features/routes/elevation-profile.test.tsx
- **location:** 51-60 (тест контраста) и 17-32
- **problem:** тест контраста проверяет пару токенов `map.corridor`/`surface.default`, а не то, что native-компонент
  их использует; число и высоты столбиков проверяются, но не `backgroundColor`, `opacity: PROFILE_FILL_OPACITY` и
  слой кромки. Возврат к `map.route` / сплошной заливке на native тесты не поймают (web-тест такую проверку делает).
- **why_it_matters:** суть фикса («не чёрный, светлая заливка») на native не закреплена тестом.
- **recommended_fix:** в native-тесте проверить `toHaveStyle({ backgroundColor: themes.light.map.corridor })` у
  столбика и `opacity: PROFILE_FILL_OPACITY` у родителя заливки.

### [LOW] Сценарий web-«меньше двух точек»: рамка графика без графика
- **file:** apps/app/src/features/routes/profile-chart.web.tsx
- **location:** 27-28
- **problem:** при `profile.length < 2` (или последняя дистанция ≤ 0) web-`ProfileChart` возвращает `null`, но
  `ElevationProfile` всё равно рисует заголовок, диапазон, пустую область с нижней границей и подписи оси; native в
  том же случае рисует один столбик на всю ширину — платформы расходятся.
- **why_it_matters:** косметика на вырожденных данных (сервер, судя по продукту, присылает до 300 точек; профиль из
  одной точки маловероятен).
- **recommended_fix:** по желанию — в `ElevationProfile` не показывать блок при `profile.length < 2` (как при
  `elevation === null`), одинаково для обеих платформ.

Заметка (не находка): для 03b нет `task.md` (только `pr.md`) — acceptance взяты из исходного требования
пользователя. Тест `profilePoints` добавлен внутрь кейса «высоты столбиков» — читаемость, не дефект.

NOT VERIFIED: вид на устройствах iOS/Android и в браузере (визуальная проверка не выполнялась — нет сборки/устройства
в ревью).

## Фиксы после pass 1

- MEDIUM: native — кромка убрана, только силуэт `PROFILE_NATIVE_FILL_OPACITY` (0,3) в `map.corridor`.
- LOW 2: native-тест проверяет цвет `map.corridor`, отсутствие кромки и прозрачность силуэта.
- LOW 3: не исправлялся — сервер отдаёт профиль ≥ 2 точек (схема `CatalogRouteElevation`).
