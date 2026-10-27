import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Сторож CSP карты панели (routes-05, RC-4): origin стиля `VITE_MAP_STYLE_LIGHT` сборки стенда (`deploy-dev.yml`)
 * разрешён в `connect-src` CSP панели (`admin-nginx.conf`), воркер MapLibre — `worker-src 'self' blob:`. Смена
 * провайдера без правки CSP — красный тест, а не пустая карта на стенде.
 */
const repo = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name)
    ?.slice(1) ?? [];

describe('CSP панели и стиль карты (routes-05, RC-4)', () => {
  const csp = /set \$panel_csp "([^"]+)";/.exec(repo('infra/docker/admin-nginx.conf'))?.[1] ?? '';
  const styleUrl = /VITE_MAP_STYLE_LIGHT=(\S+)/.exec(repo('.github/workflows/deploy-dev.yml'))?.[1];

  it('origin стиля из deploy-dev.yml — в connect-src', () => {
    expect(styleUrl).toBeDefined();
    expect(directive(csp, 'connect-src')).toContain(new URL(styleUrl!).origin);
  });

  it("воркер — worker-src 'self' blob:; растры спрайтов — img-src blob:", () => {
    expect(directive(csp, 'worker-src')).toEqual(["'self'", 'blob:']);
    expect(directive(csp, 'img-src')).toContain('blob:');
    expect(directive(csp, 'script-src')).toEqual(["'self'"]);
  });

  it('воркер .mjs (модульный) отдаётся как application/javascript, с CSP и nosniff (ревью pass 1, M2)', () => {
    const conf = repo('infra/docker/admin-nginx.conf');
    const block = /location ~ \^\/admin\/assets\/\.\+\\\.mjs\$ \{([^}]*\{\s*\}[^}]*)\}/.exec(
      conf,
    )?.[1];
    expect(block).toBeDefined();
    expect(block).toMatch(/types \{\s*\}/);
    expect(block).toContain('default_type application/javascript;');
    expect(block).toContain('add_header Content-Security-Policy $panel_csp always;');
    expect(block).toContain('add_header X-Content-Type-Options "nosniff" always;');
  });
});
