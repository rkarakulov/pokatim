/// <reference types="jest" />
import {
  getPushPermission,
  obtainPushToken,
  pushSupported,
  requestPushPermission,
  storedPushToken,
  subscribePushResponses,
} from './push';

describe('push на web (N1: web push нет)', () => {
  it('push недоступен, разрешение не запрашивается, токена нет', async () => {
    expect(pushSupported).toBe(false);
    expect(await getPushPermission()).toEqual({ status: 'unavailable', canAskAgain: false });
    expect(await requestPushPermission()).toEqual({ status: 'unavailable', canAskAgain: false });
    expect(await obtainPushToken()).toBeNull();
    expect(await storedPushToken()).toBeNull();
  });

  it('подписка на нажатия — no-op', () => {
    const onOpen = jest.fn();
    const unsubscribe = subscribePushResponses({ onOpen, onReceive: jest.fn() });
    unsubscribe();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
