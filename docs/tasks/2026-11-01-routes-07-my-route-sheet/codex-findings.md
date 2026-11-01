# Findings — routes-07-my-route-sheet — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..HEAD
verdict: REQUEST CHANGES

### [HIGH] Отступ клавиатуры не поднимает абсолютно позиционированную шторку
- **file:** apps/app/src/features/routes/my-route-detail.tsx
- **location:** 296–309, `MyRouteSheet`
- **problem:** `BottomSheet` размещён непосредственно внутри `KeyboardAvoidingArea`. На iOS `behavior="padding"` добавляет контейнеру `paddingBottom`, но шторка с `position: 'absolute', bottom: 0` остаётся у нижней границы контейнера. Карта также абсолютно позиционирована. Отступ не уменьшает область, относительно которой расположена шторка.
- **why_it_matters:** При вводе названия клавиатура перекрывает форму и её действия; на небольшом экране может перекрыть и поле. Основная цель задачи — переименование над клавиатурой — не выполнена на iOS.
- **evidence:** `components/keyboard-avoiding-area.ios.tsx:5` использует `behavior="padding"`; `components/bottom-sheet-props.ts`, `sheetStyles.sheet` задаёт `position: 'absolute'` и `bottom: 0`. Установленный React Native в `Libraries/Components/Keyboard/KeyboardAvoidingView.js`, ветка `padding`, меняет только `paddingBottom`. Yoga в `ReactCommon/yoga/yoga/algorithm/AbsoluteLayout.cpp`, `positionAbsoluteChild`, рассчитывает положение при заданном нижнем inset без вычитания padding родителя. Тест `my-routes.test.tsx:360–369` проверяет лишь нулевой отступ без клавиатуры и наличие пропса, поэтому этот дефект не обнаруживает.
- **recommended_fix:** Внутри `KeyboardAvoidingArea` добавить обычный контейнер `View` с `flex: 1` и перенести в него карту и шторку. Тогда padding уменьшит высоту внутреннего контейнера, а шторка поднимется вместе с его нижней границей. Проверить реальное положение поля и кнопок при открытой клавиатуре на iOS.

NOT VERIFIED: `pnpm check` и тесты в этом проходе не запускались; проверка клавиатуры на устройствах не выполнялась. Вывод о раскладке основан на коде приложения и установленных React Native/Yoga.