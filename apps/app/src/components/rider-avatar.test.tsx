/// <reference types="jest" />
import { layout, stroke, themes } from '@pokatim/design-tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { api } from '@/lib/api';

import { RiderAvatar } from './rider-avatar';

jest.mock('@/lib/api');

beforeEach(() => {
  jest.mocked(api.avatarUrl).mockImplementation((id) => `https://api.test/v1/avatars/${id}`);
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('RiderAvatar (rider-profile, AC12)', () => {
  it('фото — expo-image по публичному адресу, квадрат с рамкой text.primary; метка «Фото профиля»', async () => {
    await render(<RiderAvatar avatarId="a1" dimension={layout.avatarProfile} />);

    const photo = screen.getByTestId('rider-avatar-photo');
    expect(photo).toHaveProp('source', { uri: 'https://api.test/v1/avatars/a1' });
    expect(photo).toHaveProp('contentFit', 'cover');
    expect(photo).toHaveProp('cachePolicy', 'memory-disk');
    expect(screen.getByRole('image', { name: 'Фото профиля' })).toHaveStyle({
      width: layout.avatarProfile,
      height: layout.avatarProfile,
      borderWidth: stroke.hairline,
      borderColor: themes.light.text.primary,
    });
  });

  it('нет фото — иконка человека на surface.raised, метка «Фото не выбрано»', async () => {
    await render(<RiderAvatar avatarId={null} dimension={layout.avatarProfile} />);
    expect(screen.getByTestId('rider-avatar-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('rider-avatar-photo')).toBeNull();
    expect(screen.getByRole('image', { name: 'Фото не выбрано' })).toHaveStyle({
      backgroundColor: themes.light.surface.raised,
    });
    expect(api.avatarUrl).not.toHaveBeenCalled();
  });

  it('ошибка загрузки (удалённый аватар, сеть) — пустой квадрат; новый id — снова фото', async () => {
    const view = await render(<RiderAvatar avatarId="a1" dimension={layout.avatarProfile} />);
    await fireEvent(screen.getByTestId('rider-avatar-photo'), 'error', {});
    expect(screen.getByTestId('rider-avatar-empty')).toBeOnTheScreen();

    await view.rerender(<RiderAvatar avatarId="a2" dimension={layout.avatarProfile} />);
    expect(screen.getByTestId('rider-avatar-photo')).toHaveProp('source', {
      uri: 'https://api.test/v1/avatars/a2',
    });
  });

  it('фон шапки — surface.default', async () => {
    await render(
      <RiderAvatar avatarId={null} dimension={layout.avatarProfile} background="default" />,
    );
    expect(screen.getByTestId('rider-avatar')).toHaveStyle({
      backgroundColor: themes.light.surface.default,
    });
  });
});
