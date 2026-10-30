/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ModalSheet } from './modal-sheet';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe('ModalSheet', () => {
  const renderSheet = async (
    onClose = jest.fn(),
    extra: Partial<Parameters<typeof ModalSheet>[0]> = {},
  ) => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ModalSheet title="Райд опубликован" onClose={onClose} testID="sheet" {...extra}>
          <Text>Тело шита</Text>
        </ModalSheet>
      </SafeAreaProvider>,
    );
    return onClose;
  };

  it('заголовок — heading, панель — modal для скринридера, тело внутри', async () => {
    await renderSheet();
    expect(screen.getByRole('heading', { name: 'Райд опубликован' })).toBeOnTheScreen();
    const sheet = screen.getByTestId('sheet');
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    // dialog с именем — сам `Modal` (web), панель второго dialog не создаёт
    expect(sheet.props.role).toBeUndefined();
    expect(screen.getByText('Тело шита')).toBeOnTheScreen();
  });

  it('titleInContent — заголовок не рисуется; headerAction — над содержимым', async () => {
    await renderSheet(jest.fn(), {
      titleInContent: true,
      placement: 'dialog',
      headerAction: <Pressable accessibilityRole="button" accessibilityLabel="Закрыть окно" />,
    });
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'Закрыть окно' })).toBeOnTheScreen();
    expect(screen.getByText('Тело шита')).toBeOnTheScreen();
  });

  it('касание затемнения и «Назад»/Esc (onRequestClose) — onClose', async () => {
    const onClose = await renderSheet();
    await fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByLabelText('Райд опубликован'), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('затемнение скрыто от скринридера', async () => {
    await renderSheet();
    const scrim = screen.getByTestId('sheet-scrim', { includeHiddenElements: true });
    expect(scrim.props.accessible).toBe(false);
    expect(scrim.props.importantForAccessibility).toBe('no');
  });
});
