/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { PushPermissionState } from './push';
import { PushPermissionRow } from './push-permission-row';

const mockPush = {
  getPushPermission: jest.fn<Promise<PushPermissionState>, []>(),
  requestPushPermission: jest.fn<Promise<PushPermissionState>, []>(),
};
jest.mock('./push', () => ({
  canOpenPushSettings: false,
  openPushSettings: async () => undefined,
  getPushPermission: () => mockPush.getPushPermission(),
  requestPushPermission: () => mockPush.requestPushPermission(),
}));
const mockRegister = jest.fn(async () => undefined);
jest.mock('./push-registration', () => ({ registerDevicePush: () => mockRegister() }));

const granted = (subscription: PushPermissionState['subscription']): PushPermissionState => ({
  status: 'granted',
  canAskAgain: false,
  subscription,
});

afterEach(() => jest.clearAllMocks());

describe('строка push в web (ADR-0022): реальное состояние', () => {
  it('подписка есть и принята сервером — строки нет', async () => {
    mockPush.getPushPermission.mockResolvedValue(granted('active'));
    render(<PushPermissionRow />);
    await waitFor(() => expect(mockPush.getPushPermission).toHaveBeenCalled());
    expect(screen.queryByText('Включить push-уведомления')).toBeNull();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('разрешено без подписки: сначала тихая подписка; получилась — строки нет', async () => {
    mockPush.getPushPermission
      .mockResolvedValueOnce(granted('missing'))
      .mockResolvedValue(granted('active'));
    render(<PushPermissionRow />);
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Включить push-уведомления')).toBeNull();
  });

  it('подписаться не вышло — строка «не подписан»; нажатие подписывает снова', async () => {
    mockPush.getPushPermission.mockResolvedValue(granted('missing'));
    render(<PushPermissionRow />);
    const hint = await screen.findByText(
      'Уведомления разрешены, но этот браузер не подписан. Нажмите, чтобы подписаться.',
    );
    mockPush.getPushPermission.mockResolvedValue(granted('active'));
    fireEvent.click(hint);
    await waitFor(() => expect(screen.queryByText('Включить push-уведомления')).toBeNull());
    expect(mockRegister).toHaveBeenCalledTimes(2);
  });

  it('подписка истекла и не обновилась — предупреждение «истекла»', async () => {
    mockPush.getPushPermission.mockResolvedValue(granted('expired'));
    render(<PushPermissionRow />);
    expect(
      await screen.findByText('Подписка на push в этом браузере истекла. Нажмите, чтобы обновить.'),
    ).toBeTruthy();
  });

  it('запрещено в браузере — объяснение, где включить, без действия', async () => {
    mockPush.getPushPermission.mockResolvedValue({ status: 'denied', canAskAgain: false });
    render(<PushPermissionRow />);
    const text = await screen.findByText(/запрещены для сайта/);
    fireEvent.click(text);
    expect(mockPush.requestPushPermission).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('не спрашивали — нажатие: системный запрос, затем подписка', async () => {
    mockPush.getPushPermission.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    mockPush.requestPushPermission.mockResolvedValue(granted('missing'));
    render(<PushPermissionRow />);
    const row = await screen.findByText(
      'Нажмите, чтобы разрешить push-уведомления на этом устройстве.',
    );
    mockPush.getPushPermission.mockResolvedValue(granted('active'));
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByText('Включить push-уведомления')).toBeNull());
    expect(mockPush.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('браузер или сервер без Web Push — строки нет', async () => {
    mockPush.getPushPermission.mockResolvedValue({ status: 'unavailable', canAskAgain: false });
    render(<PushPermissionRow />);
    await waitFor(() => expect(mockPush.getPushPermission).toHaveBeenCalled());
    expect(screen.queryByText('Включить push-уведомления')).toBeNull();
  });
});
