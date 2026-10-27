/// <reference types="jest" />
import * as Notifications from 'expo-notifications';

import { pushTargetPath } from './notification-target';
import { subscribePushResponses } from './push';

const RIDE = '0190a6f4-0000-7000-8000-000000000002';

const response = (data: unknown) =>
  ({ notification: { request: { content: { data } } }, actionIdentifier: 'default' }) as never;

afterEach(() => jest.clearAllMocks());

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
