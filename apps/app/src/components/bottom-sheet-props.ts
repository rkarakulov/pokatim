import { size, stroke, type AppTheme } from '@pokatim/design-tokens';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { SHEET_MAX_HEIGHT } from './bottom-sheet-snap';

/** Общий API шторки (`bottom-sheet.tsx` — native, `bottom-sheet.web.tsx` — web). */
export interface BottomSheetProps {
  /** состояние — у экрана (SSR и первый рендер — развёрнута, L6) */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** шапка: видна и в свёрнутом виде (строка цифр); за неё и «чёрточку» тянут */
  header: ReactNode;
  /** тело (экран передаёт `ScrollView` с `RefreshControl`); свёрнута — `display: none` (вне a11y и Tab-порядка) */
  children: ReactNode;
  /** видимая высота шторки, px — после измерения и в конце снапа (не на кадр) */
  onVisibleHeightChange?: (height: number) => void;
  /** подписи «чёрточки»: развёрнута — «свернуть», свёрнута — «развернуть» */
  collapseLabel: string;
  expandLabel: string;
  testID?: string;
}

/** testID жеста шапки (native) — для `createGestureController` в тестах. */
export const SHEET_PAN_TEST_ID = 'bottom-sheet-pan';

/** Цвета шторки из ролей темы: поверхность шторки, hairline сверху, «чёрточка» — сильная граница. */
export const sheetColors = (theme: AppTheme) => ({
  backgroundColor: theme.surface.sheet,
  borderTopColor: theme.border.subtle,
});

export const sheetStyles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: SHEET_MAX_HEIGHT,
    borderTopWidth: stroke.hairline,
  },
  // цель касания — не меньше touchMin, полоса — квадратная (эстетика без скруглений, RC-17)
  grabber: { minHeight: size.touchMin, alignItems: 'center', justifyContent: 'center' },
  bar: { width: size.touchMin, height: stroke.bannerError },
  body: { flexShrink: 1, minHeight: 0 },
  hidden: { display: 'none' },
});
