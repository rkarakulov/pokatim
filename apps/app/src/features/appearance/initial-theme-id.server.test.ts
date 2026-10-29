/// <reference types="jest" />
import { initialThemeId } from './initial-theme-id.web';

// проект server разбирает workspace-пакеты из dist: контракты здесь не нужны — ветка браузера не исполняется
jest.mock('./ssr-theme', () => ({ ssrThemeId: () => 'navigation' }));
jest.mock('./theme-id', () => ({ toAppThemeId: () => 'classic' }));

// проект jest `server` (Node, без `window`) — как web SSR
describe('initialThemeId (web, сервер)', () => {
  it('без window — тема SSR из cookie запроса', () => {
    expect(typeof window).toBe('undefined');
    expect(initialThemeId()).toBe('navigation');
  });
});
