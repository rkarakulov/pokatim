/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';

import { NotificationBell, unreadBadge } from './notification-bell';

describe('NotificationBell (N9)', () => {
  it.each([
    [0, null],
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [250, '99+'],
  ])('счётчик %d → %s', (count, badge) => {
    expect(unreadBadge(count)).toBe(badge);
  });

  it('непрочитанные — счётчик и подпись «Уведомления, N непрочитанных»', async () => {
    const open = jest.fn();
    await render(<NotificationBell count={7} onPress={open} />);

    const bell = screen.getByRole('button', { name: 'Уведомления, 7 непрочитанных' });
    expect(screen.getByText('7')).toBeOnTheScreen();
    await fireEvent.press(bell);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('больше 99 — «99+» и подпись без точного числа', async () => {
    await render(<NotificationBell count={100} onPress={jest.fn()} />);
    expect(screen.getByText('99+')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Уведомления, больше 99 непрочитанных' }),
    ).toBeOnTheScreen();
  });

  it.each([0, undefined])(
    'нет непрочитанных или счётчик неизвестен (%s) — без счётчика',
    async (count) => {
      await render(<NotificationBell count={count} onPress={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Уведомления' })).toBeOnTheScreen();
      expect(screen.queryByText('0')).toBeNull();
    },
  );
});
