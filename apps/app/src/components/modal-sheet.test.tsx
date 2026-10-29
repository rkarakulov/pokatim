/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ModalSheet } from './modal-sheet';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe('ModalSheet', () => {
  const renderSheet = async (onClose = jest.fn()) => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ModalSheet title="Райд опубликован" onClose={onClose} testID="sheet">
          <Text>Тело шита</Text>
        </ModalSheet>
      </SafeAreaProvider>,
    );
    return onClose;
  };

  it('заголовок — heading, окно — modal dialog с именем заголовка, тело внутри', async () => {
    await renderSheet();
    expect(screen.getByRole('heading', { name: 'Райд опубликован' })).toBeOnTheScreen();
    const sheet = screen.getByTestId('sheet');
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    expect(sheet.props.role).toBe('dialog');
    expect(sheet.props['aria-label']).toBe('Райд опубликован');
    expect(screen.getByText('Тело шита')).toBeOnTheScreen();
  });

  it('касание затемнения и «Назад»/Esc (onRequestClose) — onClose', async () => {
    const onClose = await renderSheet();
    await fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByTestId('sheet'), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('затемнение скрыто от скринридера', async () => {
    await renderSheet();
    const scrim = screen.getByTestId('sheet-scrim', { includeHiddenElements: true });
    expect(scrim.props.accessible).toBe(false);
    expect(scrim.props.importantForAccessibility).toBe('no');
  });
});
