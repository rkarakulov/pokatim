/// <reference types="jest" />
import { size, themes } from '@pokatim/design-tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TopBar } from './top-bar';

describe('TopBar', () => {
  it('словесный знак — заголовок с меткой «Покатим», шрифт brand, высота панели — токен', async () => {
    await render(<TopBar />);

    const wordmark = screen.getByRole('header', { name: 'Покатим' });
    expect(wordmark).toHaveTextContent('ПОКАТИМ');
    expect(wordmark).toHaveStyle({
      fontFamily: 'PlayfairDisplay_600SemiBold',
      color: themes.light.text.primary,
    });
    expect(screen.getByTestId('top-bar')).toHaveStyle({ height: size.topBarHeight });
  });

  it('в v1 без колокольчика и аватара (Q8, блоки уведомлений и профиля)', async () => {
    await render(<TopBar />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('иконка «Устройства» на месте аватара — кнопка с доступной подписью', async () => {
    const open = jest.fn();
    await render(<TopBar onOpenDevices={open} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Устройства' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('иконка «Профиль» после «Устройств» — кнопка с доступной подписью (profile-rider-name)', async () => {
    const openDevices = jest.fn();
    const openProfile = jest.fn();
    await render(<TopBar onOpenDevices={openDevices} onOpenProfile={openProfile} />);

    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Устройства',
      'Профиль',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Профиль' }));
    expect(openProfile).toHaveBeenCalledTimes(1);
    expect(openDevices).not.toHaveBeenCalled();
  });

  it('колокольчик со счётчиком — первым справа (notifications)', async () => {
    const openNotifications = jest.fn();
    await render(
      <TopBar
        onOpenNotifications={openNotifications}
        unreadCount={3}
        onOpenDevices={jest.fn()}
        onOpenProfile={jest.fn()}
      />,
    );

    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Уведомления, 3 непрочитанных',
      'Устройства',
      'Профиль',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Уведомления, 3 непрочитанных' }));
    expect(openNotifications).toHaveBeenCalledTimes(1);
  });
});
