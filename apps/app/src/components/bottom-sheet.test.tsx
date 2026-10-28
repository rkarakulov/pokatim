/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { BottomSheet } from './bottom-sheet';
import { SHEET_PAN_TEST_ID } from './bottom-sheet-props';
import { SHEET_ANIMATION_MS, SHEET_FLING_VELOCITY } from './bottom-sheet-snap';

const reduceMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');

function Harness({
  onHeight,
  onChange,
}: {
  onHeight?: (height: number) => void;
  onChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <GestureHandlerRootView>
      <BottomSheet
        expanded={expanded}
        onExpandedChange={(next) => {
          onChange?.(next);
          setExpanded(next);
        }}
        onVisibleHeightChange={onHeight}
        collapseLabel="Свернуть панель"
        expandLabel="Развернуть панель"
        header={<Text>Дистанция 86 км</Text>}
      >
        <Text>Гонки на маршруте</Text>
      </BottomSheet>
    </GestureHandlerRootView>
  );
}

const grabber = () => screen.getByTestId('bottom-sheet-grabber');
/** Раскладка: тело — 300 px, шторка — 380 px (развёрнута) / 80 px (свёрнута). */
const layout = async (sheet: number, body = 300) => {
  await fireEvent(
    screen.getByTestId('bottom-sheet-body', { includeHiddenElements: true }),
    'layout',
    {
      nativeEvent: { layout: { x: 0, y: 0, width: 375, height: body } },
    },
  );
  await fireEvent(screen.getByTestId('bottom-sheet'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 375, height: sheet } },
  });
};

beforeEach(() => {
  reduceMotion.mockResolvedValue(true);
});

describe('BottomSheet native (routes-04d, L2, L4, RC-2, RC-17)', () => {
  it('развёрнута по умолчанию: «чёрточка» — кнопка «Свернуть панель» с expanded, шапка и тело видны', async () => {
    await render(<Harness />);
    expect(grabber()).toHaveProp('accessibilityRole', 'button');
    expect(screen.getByRole('button', { name: 'Свернуть панель' })).toBe(grabber());
    expect(grabber()).toHaveProp('accessibilityState', { expanded: true });
    expect(screen.getByText('Дистанция 86 км')).toBeOnTheScreen();
    expect(screen.getByText('Гонки на маршруте')).toBeOnTheScreen();
  });

  it('тап — свернуть: тело скрыто (display: none, вне a11y), шапка видна; тап — развернуть', async () => {
    await render(<Harness />);
    await fireEvent.press(grabber());
    expect(screen.getByRole('button', { name: 'Развернуть панель' })).toBeOnTheScreen();
    expect(grabber()).toHaveProp('accessibilityState', { expanded: false });
    expect(screen.queryByText('Гонки на маршруте')).toBeNull();
    expect(screen.getByTestId('bottom-sheet-body', { includeHiddenElements: true })).toHaveStyle({
      display: 'none',
    });
    expect(screen.getByText('Дистанция 86 км')).toBeOnTheScreen();
    await fireEvent.press(grabber());
    expect(screen.getByText('Гонки на маршруте')).toBeOnTheScreen();
  });

  it('видимая высота — после раскладки и после снапа', async () => {
    const onHeight = jest.fn();
    await render(<Harness onHeight={onHeight} />);
    await layout(380);
    expect(onHeight).toHaveBeenLastCalledWith(380);
    await fireEvent.press(grabber());
    await layout(80);
    expect(onHeight).toHaveBeenLastCalledWith(80);
  });

  it('жест за шапку: вниз дальше половины хода — свёрнута; бросок вверх из свёрнутой — развёрнута', async () => {
    await render(<Harness />);
    await layout(380);
    const pan = createGestureController(SHEET_PAN_TEST_ID);
    await act(async () => pan.begin({ translationY: 0 }));
    await act(async () => pan.activate({ translationY: 20 }));
    await act(async () => pan.update({ translationY: 200 }));
    // во время жеста тело видно
    expect(screen.getByText('Гонки на маршруте')).toBeOnTheScreen();
    await act(async () => pan.end({ translationY: 200, velocityY: 0 }));
    expect(grabber()).toHaveProp('accessibilityState', { expanded: false });
    expect(screen.queryByText('Гонки на маршруте')).toBeNull();

    const fling = createGestureController(SHEET_PAN_TEST_ID);
    await act(async () => fling.begin({ translationY: 0 }));
    await act(async () => fling.activate({ translationY: -20 }));
    await act(async () => fling.update({ translationY: -40 }));
    await act(async () => fling.end({ translationY: -40, velocityY: -SHEET_FLING_VELOCITY * 2 }));
    expect(grabber()).toHaveProp('accessibilityState', { expanded: true });
  });

  it('жест короче половины хода — обратно развёрнута; до измерения тела жест не двигает шторку', async () => {
    await render(<Harness />);
    const early = createGestureController(SHEET_PAN_TEST_ID);
    await act(async () => early.begin({ translationY: 0 }));
    await act(async () => early.activate({ translationY: 200 }));
    await act(async () => early.end({ translationY: 200, velocityY: 0 }));
    expect(grabber()).toHaveProp('accessibilityState', { expanded: true });
    await layout(380);
    const pan = createGestureController(SHEET_PAN_TEST_ID);
    await act(async () => pan.begin({ translationY: 0 }));
    await act(async () => pan.activate({ translationY: 20 }));
    await act(async () => pan.update({ translationY: 100 }));
    await act(async () => pan.end({ translationY: 100, velocityY: 0 }));
    expect(grabber()).toHaveProp('accessibilityState', { expanded: true });
  });

  it('анимация (reduce motion выключен): тап — снап за SHEET_ANIMATION_MS, затем свёрнута', async () => {
    reduceMotion.mockResolvedValue(false);
    jest.useFakeTimers();
    try {
      await render(<Harness />);
      await act(async () => undefined);
      await layout(380);
      await fireEvent.press(grabber());
      // идёт анимация: тело ещё видно
      expect(screen.getByText('Гонки на маршруте')).toBeOnTheScreen();
      await act(async () => {
        jest.advanceTimersByTime(SHEET_ANIMATION_MS + 100);
      });
      expect(grabber()).toHaveProp('accessibilityState', { expanded: false });
      expect(screen.queryByText('Гонки на маршруте')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ревью pass 1 (L1): шторку схватили посреди снапа — снап не считается завершённым, жест продолжается с текущего места', async () => {
    reduceMotion.mockResolvedValue(false);
    // нативный драйвер в jest не шагает анимацию: текущее значение снапа на момент захвата — 150 px
    const stop = jest
      .spyOn(Animated.Value.prototype, 'stopAnimation')
      .mockImplementation((callback) => {
        callback?.(150);
      });
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    const onChange = jest.fn();
    try {
      await render(<Harness onChange={onChange} />);
      await act(async () => undefined);
      await layout(380);
      // тап «Свернуть» — снап пошёл; сразу хватаем шапку
      await fireEvent.press(grabber());
      const pan = createGestureController(SHEET_PAN_TEST_ID);
      await act(async () => pan.begin({ translationY: 0 }));
      await act(async () => pan.activate({ translationY: 0 }));
      await act(async () => pan.update({ translationY: 10 }));
      // прерванный снап не свернул шторку посреди жеста, сдвиг — от места захвата
      expect(onChange).not.toHaveBeenCalled();
      expect(grabber()).toHaveProp('accessibilityState', { expanded: true });
      // значение уходит нативному драйверу: проверяем, что передано (до фикса — 10, от развёрнутого положения)
      expect(setValue).toHaveBeenLastCalledWith(160);
      await act(async () => pan.end({ translationY: 10, velocityY: -SHEET_FLING_VELOCITY * 2 }));
      await act(async () => undefined);
      expect(grabber()).toHaveProp('accessibilityState', { expanded: true });
    } finally {
      setValue.mockRestore();
      stop.mockRestore();
    }
  });
});

describe('BottomSheet native: форма темы (app-themes C1)', () => {
  it('верхние углы — shape.sheet: «Классика» — прямые, Атлас — 12', async () => {
    const { unmount } = await render(<Harness />);
    expect(screen.getByTestId('bottom-sheet')).toHaveStyle({ borderTopLeftRadius: 0 });
    await unmount();
    await render(<Harness />, { wrapper: appThemeWrapper('atlas') });
    expect(screen.getByTestId('bottom-sheet')).toHaveStyle({
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
    });
  });
});
