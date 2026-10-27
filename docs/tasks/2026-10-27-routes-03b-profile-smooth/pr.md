# Маршруты 03b: профиль высоты — плавная тонкая линия вместо чёрных столбиков

## Что

Замечания пользователя к карточке маршрута (routes-03, PR #54): «профиль рисуется не плавной линией, а как будто
пикселями квадратными» и «полностью чёрный закрашенный профиль слишком много внимания на себя берёт».

- `ProfileChart` — развилка файлами:
  - **web** (`profile-chart.web.tsx`): inline SVG — плавный путь по всем точкам профиля (≤ 300), линия `stroke.input`
    (`non-scaling-stroke`) и светлая заливка под ней; разметка зависит только от данных — SSR = первый рендер;
  - **native** (`profile-chart.tsx`): 160 узких столбиков `View` (≈ 2 pt) — только светлый силуэт
    (`PROFILE_NATIVE_FILL_OPACITY` 0,3) без кромки: кромка из отдельных столбиков на подъёмах ступенчатая (ревью
    MEDIUM); новой нативной зависимости нет (react-native-svg в старых dev-сборках отсутствует).
- Цвет — приглушённая роль `map.corridor` вместо `map.route` (чёрного/белого), заливка — `PROFILE_FILL_OPACITY`
  (0,14; токена прозрачности нет, как `CORRIDOR_OPACITY`). Обе темы; контраст линии с фоном — тест WCAG для графики.
- `profilePoints` (`format.ts`) — точки пути в долях, те же правила высоты, что у столбиков.
- docs: `docs/product/routes.md`, `.claude/rules/pokatim-app.md`.

## Проверки

- Ревью pass 1 — APPROVE (MEDIUM 1, LOW 2): MEDIUM (ступенчатая кромка native) и LOW 2 (тест вида native)
  исправлены; LOW 3 (профиль < 2 точек на web — пустой график) не исправлялся: сервер отдаёт ≥ 2 точек.
- Вид web проверен на реальном профиле dev («Минск — Заславль») в обеих темах.
- jest app: `elevation-profile` (native) и `elevation-profile.web` (SSR-разметка SVG, обе темы), `format`,
  `route-detail` — зелёные; `pnpm check` — см. CI.

## NOT VERIFIED

- Вид на устройстве iOS/Android (столбики 2 px без швов) — после выката, вручную.
- Follow-up: плавный путь и на native через `react-native-svg` вместе со скраббингом routes-04, когда dev-сборка
  обновится.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
