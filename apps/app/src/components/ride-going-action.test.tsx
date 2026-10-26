/// <reference types="jest" />
import type { RideViewer } from '@pokatim/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { RideGoingAction } from './ride-going-action';

const upcoming = { phase: 'upcoming', full: false, limit: 12 } as const;
const viewer = (role: RideViewer['role'], rights: Partial<RideViewer> = {}): RideViewer => ({
  role,
  canJoin: false,
  canLeave: false,
  canManage: false,
  ...rights,
});

describe('RideGoingAction — по viewer, full и phase сервера', () => {
  it('можно записаться: строка — secondary «Я иду», нажатие — onJoin', async () => {
    const onJoin = jest.fn();
    await render(
      <RideGoingAction
        ride={upcoming}
        viewer={viewer('none', { canJoin: true })}
        variant="row"
        onJoin={onJoin}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Я иду' }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('участник: лента — текст «Вы идёте»; карточка — баннер и «Не иду»', async () => {
    const onLeave = jest.fn();
    const { rerender } = await render(
      <RideGoingAction
        ride={upcoming}
        viewer={viewer('participant')}
        variant="row"
        onJoin={jest.fn()}
      />,
    );
    expect(screen.getByText('Вы идёте')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();

    await rerender(
      <RideGoingAction
        ride={upcoming}
        viewer={viewer('participant', { canLeave: true })}
        variant="card"
        goingLine="Вы идёте · Воскресенье, 4 октября 2026, 10:00"
        onJoin={jest.fn()}
        onLeave={onLeave}
      />,
    );
    expect(screen.getByText('Вы идёте · Воскресенье, 4 октября 2026, 10:00')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Не иду' }));
    expect(onLeave).toHaveBeenCalled();
  });

  it('организатор — «Вы организатор» в ленте, на карточке — ничего (действия управления — экран)', async () => {
    const { rerender } = await render(
      <RideGoingAction
        ride={upcoming}
        viewer={viewer('organizer')}
        variant="hero"
        onJoin={jest.fn()}
      />,
    );
    expect(screen.getByText('Вы организатор')).toBeOnTheScreen();
    await rerender(
      <RideGoingAction
        ride={upcoming}
        viewer={viewer('organizer')}
        variant="card"
        onJoin={jest.fn()}
      />,
    );
    expect(screen.queryByText('Вы организатор')).toBeNull();
  });

  it('мест нет: лента — текст; карточка — баннер с лимитом над выключенной «Я иду»', async () => {
    const full = { ...upcoming, full: true };
    const { rerender } = await render(
      <RideGoingAction ride={full} viewer={viewer('none')} variant="row" onJoin={jest.fn()} />,
    );
    expect(screen.getByText('Мест нет')).toBeOnTheScreen();
    await rerender(
      <RideGoingAction ride={full} viewer={viewer('none')} variant="card" onJoin={jest.fn()} />,
    );
    expect(screen.getByText('Мест нет — все 12 мест заняты.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Я иду' })).toBeDisabled();
  });

  it('гость на карточке: «Я иду» при свободных местах (запись — после входа)', async () => {
    await render(
      <RideGoingAction ride={upcoming} viewer={null} variant="card" onJoin={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Я иду' })).toBeEnabled();
  });

  it('отменён — «Райд отменён» (карточка — баннер экрана); прошедший и unknown — без действия', async () => {
    const { rerender } = await render(
      <RideGoingAction
        ride={{ ...upcoming, phase: 'cancelled' }}
        viewer={viewer('participant')}
        variant="row"
        onJoin={jest.fn()}
      />,
    );
    expect(screen.getByText('Райд отменён')).toBeOnTheScreen();
    for (const phase of ['past', 'unknown'] as const) {
      await rerender(
        <RideGoingAction
          ride={{ ...upcoming, phase }}
          viewer={viewer('none', { canJoin: true })}
          variant="row"
          onJoin={jest.fn()}
        />,
      );
      expect(screen.toJSON()).toBeNull();
    }
    await rerender(
      <RideGoingAction
        ride={upcoming}
        viewer={viewer('unknown')}
        variant="row"
        onJoin={jest.fn()}
      />,
    );
    expect(screen.toJSON()).toBeNull();
  });

  it('ошибка действия — текст рядом с кнопкой', async () => {
    await render(
      <RideGoingAction
        ride={upcoming}
        viewer={viewer('none', { canJoin: true })}
        variant="hero"
        error="Слишком часто. Повторите через 30 с."
        onJoin={jest.fn()}
      />,
    );
    expect(screen.getByText('Слишком часто. Повторите через 30 с.')).toBeOnTheScreen();
  });
});
