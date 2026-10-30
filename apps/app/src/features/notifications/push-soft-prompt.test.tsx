/// <reference types="jest" />
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { PushPermissionState } from './push';
import { PUSH_SOFT_PROMPT_KEY, PUSH_SOFT_PROMPT_SNOOZE_MS } from './push-soft-prompt-state';
import { PushSoftPrompt } from './push-soft-prompt';
import {
  closePushSoftPromptFor,
  offerPushSoftPrompt,
  resetPushSoftPrompt,
} from './push-soft-prompt-store';

const mockPush = {
  supported: true as boolean | null,
  getPushPermission: jest.fn<Promise<PushPermissionState>, []>(),
  requestPushPermission: jest.fn<Promise<PushPermissionState>, []>(),
  openPushSettings: jest.fn(async () => undefined),
};
jest.mock('./push', () => ({
  canOpenPushSettings: true,
  usePushSupported: () => mockPush.supported,
  openPushSettings: () => mockPush.openPushSettings(),
  getPushPermission: () => mockPush.getPushPermission(),
  requestPushPermission: () => mockPush.requestPushPermission(),
}));
const mockRegister = jest.fn(async () => undefined);
jest.mock('./push-registration', () => ({ registerDevicePush: () => mockRegister() }));

const store = () => jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;
const NOW = new Date('2026-10-30T10:00:00Z');
const RIDE = 'ride-1';
const TITLE_RIDE = 'Узнайте о переносе или отмене райда';
const TITLE_RACE = 'Не пропустите изменения гонки';
const DENIED = 'Push-уведомления запрещены. Нажмите, чтобы открыть настройки устройства.';

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  mockPush.supported = true;
  mockPush.getPushPermission.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  resetPushSoftPrompt();
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

const renderOffered = async (context: 'ride' | 'race' = 'ride') => {
  await render(<PushSoftPrompt context={context} id={RIDE} />);
  await act(async () => offerPushSoftPrompt(context, RIDE));
  await screen.findByText(context === 'ride' ? TITLE_RIDE : TITLE_RACE);
};

describe('подсказка push в момент пользы', () => {
  it('без предложения (открыт экран) — ничего и без запроса разрешения', async () => {
    await render(<PushSoftPrompt context="ride" id={RIDE} />);
    await act(async () => undefined);
    expect(screen.queryByText(TITLE_RIDE)).toBeNull();
    expect(mockPush.getPushPermission).not.toHaveBeenCalled();
    expect(mockPush.requestPushPermission).not.toHaveBeenCalled();
  });

  it('после предложения — текст по контексту, системного запроса нет', async () => {
    await renderOffered('race');
    expect(screen.getByRole('button', { name: 'Включить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Не сейчас' })).toBeTruthy();
    expect(mockPush.requestPushPermission).not.toHaveBeenCalled();
  });

  it('предложение другому объекту — здесь не показывается', async () => {
    await render(<PushSoftPrompt context="ride" id={RIDE} />);
    await act(async () => offerPushSoftPrompt('ride', 'other'));
    await act(async () => undefined);
    expect(screen.queryByText(TITLE_RIDE)).toBeNull();
  });

  it('«Включить»: системный запрос, выдано — регистрация, подсказка исчезает', async () => {
    mockPush.requestPushPermission.mockResolvedValue({ status: 'granted', canAskAgain: true });
    await renderOffered();
    await fireEvent.press(screen.getByRole('button', { name: 'Включить' }));
    await waitFor(() => expect(screen.queryByText(TITLE_RIDE)).toBeNull());
    expect(mockPush.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('«Включить» и отказ — текст отказа с переходом в настройки, повторного запроса нет', async () => {
    mockPush.requestPushPermission.mockResolvedValue({ status: 'denied', canAskAgain: false });
    await renderOffered();
    await fireEvent.press(screen.getByRole('button', { name: 'Включить' }));
    const denied = await screen.findByText(DENIED);
    expect(screen.queryByRole('button', { name: 'Включить' })).toBeNull();
    // текст отказа озвучивается, фокус не переносится (a11y)
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(DENIED);
    await fireEvent.press(denied);
    await waitFor(() => expect(mockPush.openPushSettings).toHaveBeenCalledTimes(1));
    expect(mockPush.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('«Не сейчас» — скрыта и отложена на устройстве на 30 дней', async () => {
    await renderOffered();
    await fireEvent.press(screen.getByRole('button', { name: 'Не сейчас' }));
    await waitFor(() => expect(screen.queryByText(TITLE_RIDE)).toBeNull());
    await waitFor(() =>
      expect(JSON.parse(store().get(PUSH_SOFT_PROMPT_KEY) ?? '{}')).toEqual({
        snoozedAt: NOW.getTime(),
      }),
    );
    expect(mockPush.requestPushPermission).not.toHaveBeenCalled();
  });

  it('отложена «Не сейчас» меньше 30 дней назад — не показывается; позже — снова', async () => {
    store().set(
      PUSH_SOFT_PROMPT_KEY,
      JSON.stringify({ snoozedAt: NOW.getTime() - PUSH_SOFT_PROMPT_SNOOZE_MS + 1 }),
    );
    await render(<PushSoftPrompt context="ride" id={RIDE} />);
    await act(async () => offerPushSoftPrompt('ride', RIDE));
    await waitFor(() => expect(mockPush.getPushPermission).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByText(TITLE_RIDE)).toBeNull();

    resetPushSoftPrompt();
    store().set(
      PUSH_SOFT_PROMPT_KEY,
      JSON.stringify({ snoozedAt: NOW.getTime() - PUSH_SOFT_PROMPT_SNOOZE_MS }),
    );
    await act(async () => offerPushSoftPrompt('ride', RIDE));
    expect(await screen.findByText(TITLE_RIDE)).toBeTruthy();
  });

  it.each<[string, PushPermissionState, boolean | null]>([
    ['разрешение уже выдано', { status: 'granted', canAskAgain: true }, true],
    ['отказ навсегда', { status: 'denied', canAskAgain: false }, true],
    ['нет поддержки', { status: 'unavailable', canAskAgain: false }, false],
    ['поддержка ещё неизвестна', { status: 'undetermined', canAskAgain: true }, null],
  ])('%s — подсказки нет', async (_name, permission, supported) => {
    mockPush.supported = supported;
    mockPush.getPushPermission.mockResolvedValue(permission);
    await render(<PushSoftPrompt context="ride" id={RIDE} />);
    await act(async () => offerPushSoftPrompt('ride', RIDE));
    await waitFor(() => expect(mockPush.getPushPermission).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByText(TITLE_RIDE)).toBeNull();
  });

  it('за сессию — один показ: предложение в другом месте после показа не принимается', async () => {
    await render(
      <>
        <PushSoftPrompt context="ride" id={RIDE} />
        <PushSoftPrompt context="race" id="race-1" />
      </>,
    );
    await act(async () => offerPushSoftPrompt('ride', RIDE));
    await screen.findByText(TITLE_RIDE);
    await act(async () => offerPushSoftPrompt('race', 'race-1'));
    await act(async () => undefined);
    expect(screen.queryByText(TITLE_RACE)).toBeNull();
    expect(screen.getByText(TITLE_RIDE)).toBeTruthy();
  });

  it('хранилище недоступно — «Не сейчас» не падает и скрывает подсказку', async () => {
    const secure = jest.requireMock<{ setItemAsync: jest.Mock }>('expo-secure-store');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    secure.setItemAsync.mockRejectedValueOnce(new Error('unavailable'));
    await renderOffered();
    await fireEvent.press(screen.getByRole('button', { name: 'Не сейчас' }));
    await waitFor(() => expect(screen.queryByText(TITLE_RIDE)).toBeNull());
    await act(async () => offerPushSoftPrompt('ride', RIDE));
    await act(async () => undefined);
    expect(screen.queryByText(TITLE_RIDE)).toBeNull();
    warn.mockRestore();
  });

  describe('один владелец показа (ревью pass 1)', () => {
    it('два места одного райда (герой и лента) — подсказка в одном', async () => {
      await render(
        <>
          <PushSoftPrompt context="ride" id={RIDE} />
          <PushSoftPrompt context="ride" id={RIDE} />
        </>,
      );
      await act(async () => offerPushSoftPrompt('ride', RIDE));
      await screen.findByText(TITLE_RIDE);
      expect(screen.getAllByText(TITLE_RIDE)).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Включить' })).toHaveLength(1);
    });

    it('отказ — «Включить» нет ни в одном месте; повторного запроса нет', async () => {
      mockPush.requestPushPermission.mockResolvedValue({ status: 'denied', canAskAgain: true });
      await render(
        <>
          <PushSoftPrompt context="ride" id={RIDE} />
          <PushSoftPrompt context="ride" id={RIDE} />
        </>,
      );
      await act(async () => offerPushSoftPrompt('ride', RIDE));
      await fireEvent.press(await screen.findByRole('button', { name: 'Включить' }));
      expect(await screen.findByText(DENIED)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Включить' })).toBeNull();
      expect(mockPush.requestPushPermission).toHaveBeenCalledTimes(1);
    });

    it('ушли с места показа (герой → карточка) — на новом месте подсказки нет до конца сессии', async () => {
      const hero = await render(<PushSoftPrompt context="ride" id={RIDE} />);
      await act(async () => offerPushSoftPrompt('ride', RIDE));
      await screen.findByText(TITLE_RIDE);
      await hero.unmount();

      await render(<PushSoftPrompt context="ride" id={RIDE} />);
      await act(async () => undefined);
      expect(screen.queryByText(TITLE_RIDE)).toBeNull();
      await act(async () => offerPushSoftPrompt('race', 'race-1'));
      await act(async () => undefined);
      expect(screen.queryByText(TITLE_RACE)).toBeNull();
    });

    it('«Не иду» после показа — подсказка закрыта', async () => {
      await renderOffered();
      await act(async () => closePushSoftPromptFor('ride', RIDE));
      expect(screen.queryByText(TITLE_RIDE)).toBeNull();
    });
  });
});
