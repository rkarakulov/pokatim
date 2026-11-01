/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DeviceEventEmitter, Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { KeyboardAvoidingArea } from './keyboard-avoiding-area';

const METRICS = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Область 700 px от y = 100 (до низа экрана 812 — за вычетом шапки); клавиатура — от screenY 500. */
const renderArea = async () => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <KeyboardAvoidingArea testID="area" style={{ flex: 1 }} />
    </SafeAreaProvider>,
  );
  await fireEvent(screen.getByTestId('area'), 'layout', {
    persist: () => undefined,
    nativeEvent: { layout: { x: 0, y: 100, width: 375, height: 712 } },
  });
};
const keyboard = (screenY: number) => ({
  endCoordinates: { screenX: 0, screenY, width: 375, height: 812 - screenY },
  startCoordinates: { screenX: 0, screenY: 812, width: 375, height: 0 },
  duration: 0,
  easing: 'keyboard',
  isEventFromThisApp: true,
});
const paddingBottom = () =>
  StyleSheet.flatten(screen.getByTestId('area').props.style).paddingBottom as number;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('KeyboardAvoidingArea (routes-07, ревью #198)', () => {
  it('iOS: клавиатура — отступ на перекрытие минус нижний safe-area inset (его держит шторка); скрыта — 0', async () => {
    await renderArea();
    expect(paddingBottom()).toBe(0);
    await act(async () => {
      DeviceEventEmitter.emit('keyboardWillShow', keyboard(500));
    });
    // низ области 812, клавиатура с 500 → перекрытие 312, минус inset 34
    expect(paddingBottom()).toBe(278);
    await act(async () => {
      DeviceEventEmitter.emit('keyboardWillHide', keyboard(812));
    });
    expect(paddingBottom()).toBe(0);
  });

  it('Android (edge-to-edge): тот же `padding` по keyboardDidShow — окно под клавиатуру не ужимается', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderArea();
    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidShow', keyboard(500));
    });
    expect(paddingBottom()).toBe(278);
    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidHide', keyboard(812));
    });
    expect(paddingBottom()).toBe(0);
  });
});
