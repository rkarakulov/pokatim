import type { DevicePushToken, PushPermissionState } from './push';

/**
 * Web (N1, ADR-0017): web push нет — уведомления видны в центре и на колокольчике. Без `expo-notifications` в
 * web-бандле; все вызовы — no-op.
 */
export const pushSupported = false;

const UNAVAILABLE: PushPermissionState = { status: 'unavailable', canAskAgain: false };

export const getPushPermission = async (): Promise<PushPermissionState> => UNAVAILABLE;
export const requestPushPermission = async (): Promise<PushPermissionState> => UNAVAILABLE;
export async function openPushSettings(): Promise<void> {}
export const obtainPushToken = async (): Promise<DevicePushToken | null> => null;
export const storedPushToken = async (): Promise<string | null> => null;
export async function rememberPushToken(_token: string): Promise<void> {}
export async function forgetPushToken(): Promise<void> {}
export function subscribePushResponses(_handlers: {
  onOpen: (target: unknown) => void;
  onReceive: () => void;
}): () => void {
  return () => undefined;
}
