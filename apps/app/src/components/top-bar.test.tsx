/// <reference types="jest" />
import { size, themes } from '@pokatim/design-tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { api } from '@/lib/api';

import { TopBar } from './top-bar';

jest.mock('@/lib/api');

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

  it('иконка «Настройки» после «Устройств» — кнопка с доступной подписью (settings-hub)', async () => {
    const openDevices = jest.fn();
    const openSettings = jest.fn();
    await render(<TopBar onOpenDevices={openDevices} onOpenSettings={openSettings} />);

    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Устройства',
      'Настройки',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Настройки' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(openDevices).not.toHaveBeenCalled();
  });

  it('колокольчик со счётчиком — первым справа (notifications)', async () => {
    const openNotifications = jest.fn();
    await render(
      <TopBar
        onOpenNotifications={openNotifications}
        unreadCount={3}
        onOpenDevices={jest.fn()}
        onOpenSettings={jest.fn()}
      />,
    );

    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Уведомления, 3 непрочитанных',
      'Устройства',
      'Настройки',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Уведомления, 3 непрочитанных' }));
    expect(openNotifications).toHaveBeenCalledTimes(1);
  });

  it('аватар профиля — последним справа, кнопка «Профиль»; нажатие открывает профиль (rider-profile, AC12)', async () => {
    const openProfile = jest.fn();
    await render(
      <TopBar
        onOpenNotifications={jest.fn()}
        onOpenDevices={jest.fn()}
        onOpenSettings={jest.fn()}
        onOpenProfile={openProfile}
      />,
    );

    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Уведомления',
      'Устройства',
      'Настройки',
      'Профиль',
    ]);
    // фото нет — пустой квадрат 30 px с иконкой человека; метку несёт кнопка
    expect(screen.getByTestId('rider-avatar-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('rider-avatar')).toHaveStyle({
      width: size.avatarTopBar,
      height: size.avatarTopBar,
    });
    expect(screen.queryByRole('image')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Профиль' }));
    expect(openProfile).toHaveBeenCalledTimes(1);
  });

  it('с id аватара — фото по публичному адресу', async () => {
    jest.mocked(api.avatarUrl).mockReturnValue('https://api.test/v1/avatars/a1');
    await render(<TopBar onOpenProfile={jest.fn()} avatarId="a1" />);
    expect(screen.getByTestId('rider-avatar-photo')).toHaveProp('source', {
      uri: 'https://api.test/v1/avatars/a1',
    });
    expect(api.avatarUrl).toHaveBeenCalledWith('a1');
  });
});
