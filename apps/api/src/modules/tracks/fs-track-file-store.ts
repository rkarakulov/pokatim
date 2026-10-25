import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { STORAGE_KEY, type StoredTrackFile, type TrackFileStore } from './track-file-store';

const TMP_SUFFIX = '.tmp';

/**
 * Хранилище исходников на файловой системе (том `trackfiles` на dev, временный каталог в тестах). Ключ проверяется
 * регулярным выражением и не выходит за корень. Запись — во временный файл рядом и `rename` (читатель не видит
 * недописанный файл).
 */
export class FsTrackFileStore implements TrackFileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    if (!STORAGE_KEY.test(key)) throw new Error('invalid storage key');
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('invalid storage key');
    return path;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(6).toString('hex')}${TMP_SUFFIX}`;
    try {
      await writeFile(tmp, bytes, { flag: 'wx' });
      await rename(tmp, path);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathOf(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async freeBytes(): Promise<number> {
    await mkdir(this.root, { recursive: true });
    const stats = await statfs(this.root);
    return stats.bavail * stats.bsize;
  }

  async *list(): AsyncIterable<StoredTrackFile> {
    let shards: string[];
    try {
      shards = await readdir(this.root);
    } catch {
      return;
    }
    for (const shard of shards) {
      const dir = join(this.root, shard);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const path = join(dir, name);
        const info = await stat(path).catch(() => null);
        if (!info?.isFile()) continue;
        yield { key: relative(this.root, path).split(sep).join('/'), modifiedAt: info.mtime };
      }
    }
  }

  /** Удаление по ключу из `list()` — в том числе временных файлов (у них ключ не по `STORAGE_KEY`). */
  async deleteListed(key: string): Promise<void> {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) return;
    await rm(path, { force: true });
  }
}
