/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { PushPermissionState } from './push';
import { PushSoftPrompt } from './push-soft-prompt';
import { offerPushSoftPrompt, resetPushSoftPrompt } from './push-soft-prompt-store';

// «Включить» не выполнил запрос (`press` вернул `null`: строка занята другим нажатием) — подсказка остаётся
const mockPress = jest.fn<Promise<PushPermissionState | null>, []>();
jest.mock('./push', () => ({
  canOpenPushSettings: true,
  usePushSupported: () => true,
  openPushSettings: async () => undefined,
}));
jest.mock('./push-permission-row', () => ({
  deniedRow: () => ({ message: 'notifications.push.denied', warning: true, action: 'settings' }),
  usePushPermission: () => ({
    permission: { status: 'undetermined', canAskAgain: true },
    delivers: false,
    press: () => mockPress(),
    enableFromToggle: async () => null,
  }),
}));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));

beforeEach(() => resetPushSoftPrompt());

it('press без запроса (null) — подсказка с «Включить» остаётся', async () => {
  mockPress.mockResolvedValue(null);
  await render(<PushSoftPrompt context="ride" id="ride-1" />);
  await act(async () => offerPushSoftPrompt('ride', 'ride-1'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Включить' }));
  expect(mockPress).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Включить' })).toBeTruthy();
  expect(screen.getByText('Узнайте о переносе или отмене райда')).toBeTruthy();
});
