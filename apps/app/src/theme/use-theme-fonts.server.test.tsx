/// <reference types="jest" />
import * as Font from 'expo-font';
import { renderToString } from 'react-dom/server';

import type { ThemeFontSet } from './fonts';
import { useThemeFonts } from './use-theme-fonts';

jest.mock('expo-font', () => ({
  isLoaded: jest.fn(() => false),
  loadAsync: jest.fn(() => Promise.resolve()),
}));

const set: ThemeFontSet = {
  families: {} as ThemeFontSet['families'],
  assets: { Inter_400Regular: 1 },
};

// проект jest `server` (Node, без `window`) — как web SSR
describe('useThemeFonts на web-сервере (SSR)', () => {
  it('регистрирует шрифты темы синхронно в рендере и сразу готов', () => {
    function Probe() {
      const { ready } = useThemeFonts(set);
      return <span>{ready ? 'ready' : 'loading'}</span>;
    }
    expect(typeof window).toBe('undefined');
    expect(renderToString(<Probe />)).toContain('ready');
    expect(Font.loadAsync).toHaveBeenCalledWith(set.assets);
  });
});
