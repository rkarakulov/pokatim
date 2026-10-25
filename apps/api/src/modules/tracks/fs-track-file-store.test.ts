import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FsTrackFileStore } from './fs-track-file-store';
import { newStorageKey, STORAGE_KEY } from './track-file-store';

let root: string;
let store: FsTrackFileStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pokatim-store-'));
  store = new FsTrackFileStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const listAll = async () => {
  const keys: string[] = [];
  for await (const file of store.list()) keys.push(file.key);
  return keys.sort();
};

describe('ключ исходника', () => {
  it('случайный, с шардом и расширением формата; не из пользователя и времени', () => {
    const fit = newStorageKey('fit');
    expect(fit).toMatch(STORAGE_KEY);
    expect(fit.slice(0, 2)).toBe(fit.slice(3, 5));
    expect(newStorageKey('stream')).toMatch(/\.stream\.json\.gz$/);
    expect(newStorageKey('gpx')).not.toBe(newStorageKey('gpx'));
  });
});

describe('FsTrackFileStore', () => {
  it('put → get байт-в-байт, без временных файлов; delete — повторяемо', async () => {
    const key = newStorageKey('fit');
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await store.put(key, bytes);
    expect(await store.get(key)).toEqual(bytes);
    expect(await listAll()).toEqual([key]);
    await store.delete(key);
    await store.delete(key);
    expect(await listAll()).toEqual([]);
    await expect(store.get(key)).rejects.toThrow();
  });

  it('ключ не по формату (обход каталога) — ошибка до файловой системы', async () => {
    await expect(store.put('../etc/passwd', new Uint8Array([1]))).rejects.toThrow(
      'invalid storage key',
    );
    await expect(store.get('aa/../../x.fit')).rejects.toThrow('invalid storage key');
    await expect(store.delete('/abs/path.fit')).rejects.toThrow('invalid storage key');
  });

  it('list видит и временные файлы недописанной записи; deleteListed удаляет их, но не выходит за корень', async () => {
    const key = newStorageKey('gpx');
    await store.put(key, new Uint8Array([1]));
    const tmp = `${key}.abc.tmp`;
    await writeFile(join(root, tmp), 'partial');
    expect(await listAll()).toEqual([key, tmp].sort());
    await store.deleteListed(tmp);
    await store.deleteListed('../outside');
    expect(await listAll()).toEqual([key]);
    expect(await readdir(root)).toHaveLength(1);
  });

  it('свободное место тома — положительное число', async () => {
    expect(await store.freeBytes()).toBeGreaterThan(0);
  });
});
