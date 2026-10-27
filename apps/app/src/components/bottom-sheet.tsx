import type { AppTheme } from '@pokatim/design-tokens';
import { useReducedMotion, useTheme } from '@rkarakulov/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SHEET_PAN_TEST_ID,
  sheetColors,
  sheetStyles as styles,
  type BottomSheetProps,
} from './bottom-sheet-props';
import {
  clampSheetOffset,
  SHEET_ANIMATION_MS,
  SHEET_DRAG_SLOP,
  snapExpanded,
} from './bottom-sheet-snap';

/**
 * Шторка поверх карты (native, routes-04d, L2, RC-1…RC-3, RC-17): «чёрточка» и шапка (строка цифр) видны всегда,
 * тело — когда развёрнута, во время перетаскивания и анимации. Перетаскивание — только за шапку: RNGH v3
 * `usePanGesture` (`runOnJS`, конфиг стабилен — `useMemo`), сдвиг — `Animated.Value` из `react-native` (без
 * Reanimated: `setValue` на кадр жеста, снап — `timing` с нативным драйвером); итог — `snapExpanded` (половина хода
 * или бросок). Тап по «чёрточке» — переключение (альтернатива жесту, кнопка с `expanded`); активация жеста отменяет
 * JS-responder — тап после перетаскивания не срабатывает. До измерения тела — без перетаскивания, тап без анимации;
 * reduce motion (`null` — как «уменьшить») — снап без анимации. Видимая высота — наружу в конце снапа и при смене
 * раскладки (не на кадр). Нижний inset — `SafeAreaView` внутри шторки.
 */
export function BottomSheet({
  expanded,
  onExpandedChange,
  header,
  children,
  onVisibleHeightChange,
  collapseLabel,
  expandLabel,
  testID = 'bottom-sheet',
}: BottomSheetProps) {
  const theme = useTheme<AppTheme>();
  const reduced = useReducedMotion();
  const [translate] = useState(() => new Animated.Value(0));
  const [moving, setMoving] = useState(false);
  const visible = expanded || moving;

  // колбэки жеста читают актуальное через ref: конфиг жеста не пересоздаётся
  const live = useRef({ expanded, onExpandedChange, animate: reduced === false, moving });
  useLayoutEffect(() => {
    live.current = { expanded, onExpandedChange, animate: reduced === false, moving };
  });
  /** высота тела, px (ход шторки); 0 — не измерена */
  const range = useRef(0);
  /** текущее смещение вниз от развёрнутого положения, px */
  const offset = useRef(0);
  const dragging = useRef(false);
  /** смещение в начале жеста — с места, где шторку схватили (в т. ч. посреди снапа) */
  const dragStart = useRef(0);
  const pendingExpand = useRef(false);

  const settle = useCallback(
    (toExpanded: boolean) => {
      const target = toExpanded ? 0 : range.current;
      offset.current = target;
      const finish = () => {
        setMoving(false);
        if (toExpanded !== live.current.expanded) live.current.onExpandedChange(toExpanded);
      };
      if (!live.current.animate) {
        translate.setValue(target);
        finish();
        return;
      }
      Animated.timing(translate, {
        toValue: target,
        duration: SHEET_ANIMATION_MS,
        useNativeDriver: true,
        // прерванный снап (шторку схватили) — не итог: состояние решит новый жест (ревью pass 1, L1)
      }).start(({ finished }) => {
        if (finished) finish();
      });
    },
    [translate],
  );

  // кадр до отрисовки: свёрнута — без сдвига; тело появилось для движения из свёрнутой — сразу на месте (без вспышки)
  useLayoutEffect(() => {
    if (!visible) {
      translate.setValue(0);
      return;
    }
    if (moving && !expanded) {
      translate.setValue(offset.current);
      if (pendingExpand.current) {
        pendingExpand.current = false;
        settle(true);
      }
    }
  }, [visible, moving, expanded, translate, settle]);

  const config = useMemo(
    () => ({
      testID: SHEET_PAN_TEST_ID,
      runOnJS: true,
      activeOffsetY: [-SHEET_DRAG_SLOP, SHEET_DRAG_SLOP] as [number, number],
      failOffsetX: [-SHEET_DRAG_SLOP * 2, SHEET_DRAG_SLOP * 2] as [number, number],
      onActivate: () => {
        if (range.current <= 0) return;
        dragging.current = true;
        dragStart.current = live.current.expanded ? 0 : range.current;
        // снап ещё идёт — продолжаем с текущего значения, без рывка
        translate.stopAnimation((value) => {
          if (live.current.moving) dragStart.current = clampSheetOffset(value, range.current);
        });
        offset.current = dragStart.current;
        setMoving(true);
      },
      onUpdate: (event: { translationY: number }) => {
        if (!dragging.current) return;
        offset.current = clampSheetOffset(dragStart.current + event.translationY, range.current);
        translate.setValue(offset.current);
      },
      onDeactivate: (event: { velocityY: number }) => {
        if (!dragging.current) return;
        dragging.current = false;
        settle(snapExpanded(offset.current, event.velocityY, range.current));
      },
      onFinalize: () => {
        // жест отменён после активации (без onDeactivate) — на прежнее место
        if (!dragging.current) return;
        dragging.current = false;
        settle(live.current.expanded);
      },
    }),
    [translate, settle],
  );
  const pan = usePanGesture(config);

  const toggle = () => {
    if (range.current <= 0 || !live.current.animate) {
      onExpandedChange(!expanded);
      return;
    }
    if (expanded) {
      setMoving(true);
      settle(false);
    } else {
      pendingExpand.current = true;
      offset.current = range.current;
      setMoving(true);
    }
  };

  // видимая высота — наружу вне движения: после раскладки и в конце снапа
  const height = useRef<number | null>(null);
  const reported = useRef<number | null>(null);
  const report = useCallback(() => {
    const value = height.current;
    if (value === null || live.current.moving || reported.current === value) return;
    reported.current = value;
    onVisibleHeightChange?.(value);
  }, [onVisibleHeightChange]);
  useEffect(() => {
    if (!moving) report();
  }, [moving, report]);
  const onSheetLayout = (event: LayoutChangeEvent) => {
    height.current = event.nativeEvent.layout.height;
    report();
  };
  const onBodyLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    if (next > 0) range.current = next;
  };

  return (
    <Animated.View
      testID={testID}
      onLayout={onSheetLayout}
      style={[styles.sheet, sheetColors(theme), { transform: [{ translateY: translate }] }]}
    >
      <SafeAreaView edges={['bottom']} style={styles.body}>
        <GestureDetector gesture={pan}>
          <View testID={`${testID}-header`}>
            <Pressable
              testID={`${testID}-grabber`}
              accessibilityRole="button"
              accessibilityLabel={expanded ? collapseLabel : expandLabel}
              accessibilityState={{ expanded }}
              onPress={toggle}
              style={styles.grabber}
            >
              <View style={[styles.bar, { backgroundColor: theme.border.strong }]} />
            </Pressable>
            {header}
          </View>
        </GestureDetector>
        <View
          testID={`${testID}-body`}
          onLayout={onBodyLayout}
          style={[styles.body, visible ? null : styles.hidden]}
        >
          {children}
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}
