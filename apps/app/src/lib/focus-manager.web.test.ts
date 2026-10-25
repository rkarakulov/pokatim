/// <reference types="jest" />
import { focusManager } from '@tanstack/react-query';

import { connectFocusManager } from './focus-manager';

describe('focusManager (web)', () => {
  afterEach(() => focusManager.setFocused(undefined));

  it('встроенный слушатель visibilitychange: скрытая вкладка — не в фокусе, видимая — в фокусе', () => {
    connectFocusManager();
    const unsubscribe = focusManager.subscribe(() => undefined);
    const visibility = jest.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(focusManager.isFocused()).toBe(false);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(focusManager.isFocused()).toBe(true);

    unsubscribe();
    visibility.mockRestore();
  });
});
