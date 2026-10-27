import { stroke, type AppTheme } from '@pokatim/design-tokens';
import { useReducedMotion, useTheme } from '@rkarakulov/ui';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { sheetSurface, sheetStyles as styles, type BottomSheetProps } from './bottom-sheet-props';
import {
  clampSheetOffset,
  SHEET_ANIMATION_MS,
  SHEET_DRAG_SLOP,
  SHEET_MAX_HEIGHT,
  snapExpanded,
} from './bottom-sheet-snap';

/** Пауза перед отпусканием, мс: дольше — скорость броска не учитывается. */
const FLING_IDLE_MS = 100;

/** Текущий сдвиг шторки по вычисленному стилю (посреди CSS-перехода — промежуточный), px. */
function computedOffset(node: HTMLElement | null): number | null {
  if (!node || typeof getComputedStyle === 'undefined') return null;
  const transform = getComputedStyle(node).transform;
  const matrix = /^matrix\((?:[^,]+,){5}\s*([-\d.e]+)\)$/.exec(transform);
  if (matrix) return Number(matrix[1]);
  const translate = /translateY\(([-\d.e]+)px\)/.exec(transform);
  return translate ? Number(translate[1]) : null;
}

interface Drag {
  pointerId: number;
  /** нажатие началось на «чёрточке»: клик после перетаскивания — не тап */
  onGrabber: boolean;
  startY: number;
  active: boolean;
  /** ход — высота тела при начале перетаскивания */
  range: number;
  start: number;
  offset: number;
  lastY: number;
  lastTime: number;
  /** px/с, вниз — положительная */
  velocity: number;
}

/**
 * Шторка поверх карты (web, routes-04d, L2, RC-1, RC-2, RC-17): та же раскладка и логика снапа, что native, без RNGH
 * (в web-бандл не попадает). Перетаскивание за шапку — pointer events DOM с захватом указателя, `touch-action: none`
 * только на шапке; снап — CSS `transition: transform` (reduce motion — без неё). SSR — развёрнута, без измерений
 * (L6): высоты — из DOM в начале жеста и после монтирования (`ResizeObserver`). «Чёрточка» — `Pressable` с ролью
 * кнопки (Enter и Space — RN-web), `aria-expanded`; при сворачивании фокус из тела переходит на неё.
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
  const animate = reduced === false;
  const [offset, setOffset] = useState(0);
  const [moving, setMoving] = useState(false);
  // без перехода: перетаскивание пальцем и первый кадр разворачивания из свёрнутой
  const [instant, setInstant] = useState(true);
  const visible = expanded || moving;

  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const grabber = useRef<ComponentRef<typeof Pressable>>(null);
  const grabberBox = useRef<HTMLDivElement>(null);
  const range = useRef(0);
  const drag = useRef<Drag | null>(null);
  // клик после перетаскивания — не тап
  const suppressPress = useRef(false);
  const pendingExpand = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const measure = () => {
    const height = body.current?.offsetHeight ?? 0;
    if (height > 0) range.current = height;
    return range.current;
  };

  const finish = (toExpanded: boolean) => {
    setMoving(false);
    setInstant(true);
    setOffset(0);
    if (toExpanded !== expanded) onExpandedChange(toExpanded);
    if (!toExpanded && body.current?.contains(document.activeElement)) grabber.current?.focus();
  };
  const settle = (toExpanded: boolean) => {
    clearTimeout(timer.current);
    if (!animate || range.current <= 0) {
      finish(toExpanded);
      return;
    }
    setInstant(false);
    setOffset(toExpanded ? 0 : range.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      finish(toExpanded);
    }, SHEET_ANIMATION_MS);
  };

  // разворачивание из свёрнутой: тело уже в DOM на месте хода — пересчёт стиля и переход к 0
  useLayoutEffect(() => {
    if (!pendingExpand.current || !moving) return;
    pendingExpand.current = false;
    void sheet.current?.offsetHeight;
    settle(true);
  });

  const toggle = () => {
    if (suppressPress.current) {
      suppressPress.current = false;
      return;
    }
    const height = measure();
    if (!animate || height <= 0) {
      finish(!expanded);
      return;
    }
    setMoving(true);
    if (expanded) {
      settle(false);
    } else {
      pendingExpand.current = true;
      setInstant(true);
      setOffset(height);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    suppressPress.current = false;
    drag.current = {
      pointerId: event.pointerId,
      onGrabber: grabberBox.current?.contains(event.target as Node) ?? false,
      startY: event.clientY,
      active: false,
      range: 0,
      start: 0,
      offset: 0,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dy = event.clientY - current.startY;
    if (!current.active) {
      if (Math.abs(dy) < SHEET_DRAG_SLOP) return;
      const height = measure();
      if (height <= 0) {
        drag.current = null;
        return;
      }
      // снап ещё идёт (таймер не сработал) — продолжаем с текущего места перехода, без рывка (ревью pass 1, L1)
      const inTransition = timer.current !== undefined;
      clearTimeout(timer.current);
      timer.current = undefined;
      current.active = true;
      current.range = height;
      const now = inTransition ? computedOffset(sheet.current) : null;
      current.start = now === null ? (expanded ? 0 : height) : clampSheetOffset(now, height);
      // клик после жеста дойдёт только до «чёрточки», и только если жест начат на ней (ревью pass 1, L2)
      suppressPress.current = current.onGrabber;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setMoving(true);
      setInstant(true);
    }
    const elapsed = event.timeStamp - current.lastTime;
    if (elapsed > 0) current.velocity = ((event.clientY - current.lastY) / elapsed) * 1000;
    current.lastY = event.clientY;
    current.lastTime = event.timeStamp;
    current.offset = clampSheetOffset(current.start + dy, current.range);
    setOffset(current.offset);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.active) return;
    // клик после жеста приходит сразу за pointerup; не пришёл (захват указателя) — следующее нажатие не теряется
    setTimeout(() => {
      suppressPress.current = false;
    }, 0);
    // палец остановился перед отпусканием — броска нет
    if (event.timeStamp - current.lastTime > FLING_IDLE_MS) current.velocity = 0;
    settle(
      event.type === 'pointercancel'
        ? expanded
        : snapExpanded(current.offset, current.velocity, current.range),
    );
  };

  // видимая высота — наружу вне движения: после монтирования, смены содержимого и снапа
  const reported = useRef<number | null>(null);
  const report = useCallback(() => {
    const height = sheet.current?.offsetHeight ?? 0;
    if (height <= 0 || reported.current === height) return;
    reported.current = height;
    onVisibleHeightChange?.(height);
  }, [onVisibleHeightChange]);
  useEffect(() => {
    if (moving) return;
    report();
    const node = sheet.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [moving, expanded, report]);

  const surface = sheetSurface(theme);
  const containerStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: SHEET_MAX_HEIGHT,
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    borderTop: `${stroke.hairline}px solid ${surface.borderTopColor}`,
    borderTopLeftRadius: surface.borderTopLeftRadius,
    borderTopRightRadius: surface.borderTopRightRadius,
    backgroundColor: surface.backgroundColor,
    transform: offset ? `translateY(${offset}px)` : undefined,
    transition: instant || !animate ? undefined : `transform ${SHEET_ANIMATION_MS}ms ease`,
  };
  return (
    <div ref={sheet} data-testid={testID} style={containerStyle}>
      <SafeAreaView edges={['bottom']} style={styles.body}>
        <div
          data-testid={`${testID}-header`}
          style={headerStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div ref={grabberBox}>
            <Pressable
              ref={grabber}
              testID={`${testID}-grabber`}
              accessibilityRole="button"
              aria-label={expanded ? collapseLabel : expandLabel}
              aria-expanded={expanded}
              onPress={toggle}
              style={styles.grabber}
            >
              <View style={[styles.bar, { backgroundColor: theme.border.strong }]} />
            </Pressable>
          </div>
          {header}
        </div>
        <div ref={body} data-testid={`${testID}-body`} style={visible ? bodyStyle : hiddenStyle}>
          {children}
        </div>
      </SafeAreaView>
    </div>
  );
}

// касание шапки не прокручивает и не масштабирует страницу — его забирает шторка
const headerStyle: CSSProperties = { touchAction: 'none', flexShrink: 0 };
const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 1,
  minHeight: 0,
};
const hiddenStyle: CSSProperties = { display: 'none' };
