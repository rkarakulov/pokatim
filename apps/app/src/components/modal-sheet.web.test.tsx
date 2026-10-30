/// <reference types="jest" />
import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { ModalSheet } from './modal-sheet';

const METRICS = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

describe('ModalSheet (web)', () => {
  it('один modal dialog — `Modal` RN-web — с именем заголовка', () => {
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ModalSheet title="Райд опубликован" onClose={jest.fn()}>
          <Text>Тело шита</Text>
        </ModalSheet>
      </SafeAreaProvider>,
      { wrapper: appThemeWrapper('classic') },
    );
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].getAttribute('aria-label')).toBe('Райд опубликован');
    expect(dialogs[0].getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Райд опубликован' })).toBeTruthy();
  });
});
