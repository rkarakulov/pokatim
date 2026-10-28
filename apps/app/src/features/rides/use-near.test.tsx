/// <reference types="jest" />
import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import type * as Position from '@/features/location/current-position';

import { useNear, type NearState } from './use-near';

jest.mock('@/features/location/current-position', () => ({ readCurrentPosition: jest.fn() }));
const readPosition = jest.mocked(
  jest.requireMock<typeof Position>('@/features/location/current-position').readCurrentPosition,
);
type Read = Awaited<ReturnType<typeof Position.readCurrentPosition>>;

/** Экземпляр хука; `key` у вызывающего — перемонтирование (как возврат на вкладку после выгрузки экрана). */
const seen: NearState[] = [];
const report = (index: number, state: NearState) => {
  seen[index] = state;
};
function Probe({ index }: { index: number }) {
  const state = useNear();
  useEffect(() => report(index, state));
  return null;
}

describe('useNear (05c)', () => {
  it('номер чтения не повторяется после перемонтирования (ключ кэша — не позиция прежнего экземпляра)', async () => {
    readPosition.mockResolvedValue({ status: 'ok', lngLat: [27.56123, 53.90491] });
    const view = await render(<Probe key="first" index={0} />);
    await act(async () => seen[0]!.toggle());
    const firstRead = seen[0]!.near;
    expect(firstRead?.lngLat).toEqual([27.56, 53.9]);

    readPosition.mockResolvedValue({ status: 'ok', lngLat: [23.73, 52.1] });
    await view.rerender(<Probe key="second" index={1} />);
    expect(seen[1]!.near).toBeNull();
    await act(async () => seen[1]!.toggle());
    expect(seen[1]!.near?.lngLat).toEqual([23.73, 52.1]);
    expect(seen[1]!.near?.seq).not.toBe(firstRead?.seq);
  });

  it('выключение до ответа чтения — ответ отбрасывается', async () => {
    let resolve: (value: Read) => void = () => undefined;
    readPosition.mockReturnValue(
      new Promise<Read>((done) => {
        resolve = done;
      }),
    );
    await render(<Probe index={2} />);
    await act(async () => seen[2]!.toggle());
    await act(async () => seen[2]!.off());
    await act(async () => resolve({ status: 'ok', lngLat: [27.56, 53.9] }));
    expect(seen[2]!.near).toBeNull();
    expect(seen[2]!.active).toBe(false);
  });
});
