/// <reference types="jest" />
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAP_WORKER_FILE } from '../src/features/maps/map-worker.ts';
import { copyMapWorker, WORKER_FILE } from './copy-map-worker.ts';

describe('copyMapWorker', () => {
  it('кладёт самодостаточный воркер maplibre-gl в public/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'map-worker-'));
    try {
      const target = copyMapWorker(join(dir, 'public'));
      expect(WORKER_FILE).toBe(MAP_WORKER_FILE);
      expect(target).toBe(join(dir, 'public', MAP_WORKER_FILE));
      expect(existsSync(target)).toBe(true);
      const source = readFileSync(target, 'utf8');
      // воркер грузится по нашему URL: внешних импортов и import.meta в нём быть не должно
      expect(source).toContain('MapLibre GL JS');
      expect(source).not.toMatch(/^import /m);
      expect(source).not.toContain('import.meta');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
