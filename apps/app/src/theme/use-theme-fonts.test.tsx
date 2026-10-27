/// <reference types="jest" />
import { act, renderHook } from '@testing-library/react-native';
import * as Font from 'expo-font';

import type { ThemeFontSet } from './fonts';
import { useThemeFonts } from './use-theme-fonts';

jest.mock('expo-font', () => ({ isLoaded: jest.fn(), isLoading: jest.fn(), loadAsync: jest.fn() }));

const isLoaded = jest.mocked(Font.isLoaded);
const isLoading = jest.mocked(Font.isLoading);
const loadAsync = jest.mocked(Font.loadAsync);

const families = {} as ThemeFontSet['families'];
const setA: ThemeFontSet = { families, assets: { Inter_400Regular: 1 } };
const setB: ThemeFontSet = { families, assets: { PlayfairDisplay_500Medium: 2 } };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => jest.resetAllMocks());

describe('useThemeFonts (native и клиент web)', () => {
  it('уже загруженные файлы — готово сразу, без ожидания', async () => {
    isLoaded.mockReturnValue(true);
    loadAsync.mockResolvedValue(undefined);
    const { result } = await renderHook(() => useThemeFonts(setA));
    expect(result.current).toEqual({ ready: true, error: null });
  });

  it('набор грузится — не готово; загрузка завершилась — готово', async () => {
    isLoaded.mockReturnValue(false);
    const load = deferred();
    loadAsync.mockReturnValue(load.promise);
    const { result } = await renderHook(() => useThemeFonts(setA));
    expect(result.current.ready).toBe(false);
    expect(loadAsync).toHaveBeenCalledWith(setA.assets);
    await act(async () => load.resolve());
    expect(result.current).toEqual({ ready: true, error: null });
  });

  it('смена набора — грузит новый и до загрузки не готов', async () => {
    isLoaded.mockReturnValue(false);
    loadAsync.mockResolvedValueOnce(undefined);
    const { result, rerender } = await renderHook(
      ({ set }: { set: ThemeFontSet }) => useThemeFonts(set),
      {
        initialProps: { set: setA },
      },
    );
    await act(async () => undefined);
    expect(result.current.ready).toBe(true);

    const load = deferred();
    loadAsync.mockReturnValue(load.promise);
    await rerender({ set: setB });
    expect(result.current.ready).toBe(false);
    expect(loadAsync).toHaveBeenLastCalledWith(setB.assets);
    await act(async () => load.resolve());
    expect(result.current).toEqual({ ready: true, error: null });
  });

  it('A грузится → выбран загруженный B → загрузка A завершилась → возврат к A — готово', async () => {
    const loaded = new Set(['PlayfairDisplay_500Medium']);
    isLoaded.mockImplementation((name) => loaded.has(name));
    const loadA = deferred();
    loadAsync.mockReturnValue(loadA.promise);
    const { result, rerender } = await renderHook(
      ({ set }: { set: ThemeFontSet }) => useThemeFonts(set),
      { initialProps: { set: setA } },
    );
    expect(result.current.ready).toBe(false);

    await rerender({ set: setB });
    expect(result.current.ready).toBe(true);

    await act(async () => {
      loaded.add('Inter_400Regular');
      loadA.resolve();
    });
    await rerender({ set: setA });
    expect(result.current).toEqual({ ready: true, error: null });
  });

  it('web: @font-face уже зарегистрирован, но файл ещё скачивается — повторный рендер не готов', async () => {
    // expo-font web добавляет правило до `document.fonts.load`: isLoaded уже true, загрузка — в полёте
    isLoaded.mockReturnValue(true);
    isLoading.mockReturnValue(true);
    const load = deferred();
    loadAsync.mockReturnValue(load.promise);
    const { result, rerender } = await renderHook(
      ({ set }: { set: ThemeFontSet }) => useThemeFonts(set),
      { initialProps: { set: setA } },
    );
    await rerender({ set: setA });
    expect(result.current.ready).toBe(false);

    isLoading.mockReturnValue(false);
    await act(async () => load.resolve());
    expect(result.current).toEqual({ ready: true, error: null });
  });

  it('ошибка загрузки — готово (системные шрифты) + ошибка', async () => {
    isLoaded.mockReturnValue(false);
    const load = deferred();
    loadAsync.mockReturnValue(load.promise);
    const { result } = await renderHook(() => useThemeFonts(setA));
    const failure = new Error('font failed');
    await act(async () => load.reject(failure));
    expect(result.current).toEqual({ ready: true, error: failure });
  });
});
