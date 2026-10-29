import { requestHeaders } from 'expo-server';

/** Заголовок запроса с nonce CSP — ставит web-сервер (`server/web-server.ts`, `CSP_NONCE_HEADER`), ADR-0025. */
const CSP_NONCE_HEADER = 'x-pokatim-csp-nonce';

/**
 * Nonce CSP текущего SSR-запроса для inline-скриптов `+html.tsx`. Вне запроса (dev-сервер `expo start`, jest)
 * `requestHeaders()` бросает — `undefined`: там нет и CSP.
 */
export function cspNonce(): string | undefined {
  try {
    return requestHeaders().get(CSP_NONCE_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}
