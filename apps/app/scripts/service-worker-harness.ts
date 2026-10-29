// Тестовый помощник: service worker (`serviceWorkerSource`) в песочнице `vm` с фейковыми `self`, клиентами и окнами —
// что показал, кому написал, что открыл. Тесты SW и паритета путей цели с приложением.
import { runInNewContext } from 'node:vm';

import { serviceWorkerSource } from './service-worker.ts';

export const SW_ORIGIN = 'https://pokatim.test';
const ORIGIN = SW_ORIGIN;

type Listener = (event: unknown) => void;

/** Service worker в песочнице `vm`: `self` с регистрацией, клиентами и окнами — что показал, кому написал, что открыл. */
export function loadServiceWorker() {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const messages: { url: string; message: unknown }[] = [];
  const windows: { url: string; focused: boolean }[] = [];
  const client = (entry: { url: string; focused: boolean }) => ({
    url: entry.url,
    focus: async () => {
      entry.focused = true;
      return client(entry);
    },
    postMessage: (message: unknown) => messages.push({ url: entry.url, message }),
  });
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: () => undefined,
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => windows.map(client),
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(
    serviceWorkerSource([{ path: '/_expo/static/js/web/entry-0.js', content: 'x' }]),
    {
      self,
      caches: {},
      URL,
      fetch,
    },
  );

  /** Событие и ожидание всех `waitUntil` обработчика. */
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
  };
  const push = (payload: unknown) =>
    dispatch('push', {
      data: {
        json: () => {
          if (typeof payload === 'string') throw new SyntaxError('not json');
          return payload;
        },
      },
    });
  const click = (target: unknown) => {
    const notification = {
      data: { target },
      closed: false,
      close: () => (notification.closed = true),
    };
    return dispatch('notificationclick', { notification }).then(() => notification);
  };
  return { shown, opened, messages, windows, push, click };
}
