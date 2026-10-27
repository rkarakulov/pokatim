/// <reference types="jest" />
import { initialThemeId } from './initial-theme-id';

afterEach(() => {
  delete window.__POKATIM_THEME__;
});

describe('initialThemeId (web, браузер)', () => {
  it('тема из SSR (window.__POKATIM_THEME__)', () => {
    window.__POKATIM_THEME__ = 'atlas';
    expect(initialThemeId()).toBe('atlas');
  });

  it.each([['<script>alert(1)</script>'], ['unknown'], [''], [undefined]])(
    'недоверенное значение %p — «Классика»',
    (value) => {
      window.__POKATIM_THEME__ = value;
      expect(initialThemeId()).toBe('classic');
    },
  );
});
