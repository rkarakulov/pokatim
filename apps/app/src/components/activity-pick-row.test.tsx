/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityPickRow } from './activity-pick-row';

describe('ActivityPickRow (route-rides-02)', () => {
  it('заголовок, мета, примечание; нажатие — onPress', async () => {
    const onPress = jest.fn();
    await render(
      <ActivityPickRow
        title="12 октября, 09:30"
        details="Garmin · 88,4 км · 2:06:40"
        note="Уже проверен"
        onPress={onPress}
        accessibilityLabel="12 октября, 09:30 · Garmin · 88,4 км · 2:06:40 · Уже проверен"
      />,
    );

    const row = screen.getByRole('button', {
      name: '12 октября, 09:30 · Garmin · 88,4 км · 2:06:40 · Уже проверен',
    });
    expect(screen.getByText('12 октября, 09:30')).toBeOnTheScreen();
    expect(screen.getByText('Garmin · 88,4 км · 2:06:40')).toBeOnTheScreen();
    expect(screen.getByText('Уже проверен')).toBeOnTheScreen();
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled и busy — выключена, состояние для скринридера', async () => {
    const onPress = jest.fn();
    await render(
      <ActivityPickRow
        title="7 октября, 08:00"
        details="Файл"
        disabled
        busy
        onPress={onPress}
        accessibilityLabel="строка"
      />,
    );

    const row = screen.getByRole('button', { name: 'строка' });
    expect(row).toBeDisabled();
    expect(row).toBeBusy();
    expect(screen.queryByText('Уже проверен')).toBeNull();
    await fireEvent.press(row);
    expect(onPress).not.toHaveBeenCalled();
  });
});
