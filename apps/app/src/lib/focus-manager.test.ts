/// <reference types="jest" />
import { focusManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { connectFocusManager } from './focus-manager';

describe('focusManager (native)', () => {
  let emit: (status: AppStateStatus) => void = () => undefined;
  const remove = jest.fn();

  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      emit = listener as (status: AppStateStatus) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
    jest.restoreAllMocks();
  });

  it('AppState → focusManager: фон — не в фокусе, возврат приложения — в фокусе', () => {
    connectFocusManager();
    // подписка ставится при первом слушателе focusManager (QueryClient при mount)
    const unsubscribe = focusManager.subscribe(() => undefined);

    emit('background');
    expect(focusManager.isFocused()).toBe(false);
    emit('active');
    expect(focusManager.isFocused()).toBe(true);
    emit('inactive');
    expect(focusManager.isFocused()).toBe(false);

    unsubscribe();
    expect(remove).toHaveBeenCalled();
  });
});
