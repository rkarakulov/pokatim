/// <reference types="jest" />
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { pushTargetPath } from './notification-target';
import { requestPushPermission, subscribePushResponses } from './push';

const RIDE = '0190a6f4-0000-7000-8000-000000000002';

const response = (data: unknown) =>
  ({ notification: { request: { content: { data } } }, actionIdentifier: 'default' }) as never;

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

const callOrder = (fn: jest.Mock | ((...args: never[]) => unknown)) =>
  jest.mocked(fn).mock.invocationCallOrder[0];

describe('requestPushPermission — канал Android до системного запроса (Android 13+)', () => {
  it('Android: канал `default` создаётся до запроса разрешения', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');

    await expect(requestPushPermission()).resolves.toEqual({
      status: 'granted',
      canAskAgain: true,
    });

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ name: 'default' }),
    );
    expect(callOrder(Notifications.setNotificationChannelAsync)).toBeLessThan(
      callOrder(Notifications.requestPermissionsAsync)!,
    );
  });

  it('iOS: канала нет, только запрос', async () => {
    await requestPushPermission();
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe('subscribePushResponses — нажатие на push (N10)', () => {
  it('холодный старт по push — цель последнего ответа, ответ гасится', () => {
    jest
      .mocked(Notifications.getLastNotificationResponse)
      .mockReturnValueOnce(response({ target: { type: 'ride', rideId: RIDE } }));
    const onOpen = jest.fn();

    subscribePushResponses({ onOpen, onReceive: jest.fn() });

    expect(onOpen).toHaveBeenCalledWith({ type: 'ride', rideId: RIDE });
    expect(pushTargetPath(onOpen.mock.calls[0][0])).toBe(`/rides/${RIDE}`);
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('нажатие при работающем приложении; сводка без цели — центр уведомлений', () => {
    const onOpen = jest.fn();
    subscribePushResponses({ onOpen, onReceive: jest.fn() });
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock
      .calls[0]![0];

    listener(response({ target: null }));

    expect(onOpen).toHaveBeenCalledWith(null);
    expect(pushTargetPath(null)).toBe('/notifications');
  });

  it('push при открытом приложении — баннер и обновление счётчика', async () => {
    const onReceive = jest.fn();
    subscribePushResponses({ onOpen: jest.fn(), onReceive });
    const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0]![0]!;

    const behavior = await handler.handleNotification({} as never);

    expect(onReceive).toHaveBeenCalledTimes(1);
    expect(behavior).toMatchObject({ shouldShowBanner: true, shouldShowList: true });
  });

  it('переход не удался — ответ не гасится (повтор при следующей подписке); слушатель нажатий установлен', () => {
    jest
      .mocked(Notifications.getLastNotificationResponse)
      .mockReturnValueOnce(response({ target: { type: 'ride', rideId: RIDE } }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onOpen = jest.fn(() => {
      throw new Error('navigator is not mounted');
    });

    subscribePushResponses({ onOpen, onReceive: jest.fn() });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(Notifications.clearLastNotificationResponse).not.toHaveBeenCalled();
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('сбой обработчика показа не отключает нажатия: слушатель и холодный старт работают', () => {
    jest.mocked(Notifications.setNotificationHandler).mockImplementationOnce(() => {
      throw new Error('native module');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest
      .mocked(Notifications.getLastNotificationResponse)
      .mockReturnValueOnce(response({ target: { type: 'ride', rideId: RIDE } }));
    const onOpen = jest.fn();

    subscribePushResponses({ onOpen, onReceive: jest.fn() });

    expect(onOpen).toHaveBeenCalledWith({ type: 'ride', rideId: RIDE });
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
  });

  it('отписка снимает слушатель и обработчик', () => {
    const remove = jest.fn();
    jest
      .mocked(Notifications.addNotificationResponseReceivedListener)
      .mockReturnValueOnce({ remove } as never);
    const unsubscribe = subscribePushResponses({ onOpen: jest.fn(), onReceive: jest.fn() });

    unsubscribe();

    expect(remove).toHaveBeenCalled();
    expect(Notifications.setNotificationHandler).toHaveBeenLastCalledWith(null);
  });
});
