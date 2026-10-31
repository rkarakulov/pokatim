import { themes } from '@pokatim/design-tokens';
import { describe, expect, it, vi } from 'vitest';

import { installDesignSystem } from './design-system';

describe('installDesignSystem', () => {
  it('добавляет стиль темы panel первым в head', () => {
    const style = { id: '', textContent: '' };
    const prepend = vi.fn();
    const doc = { createElement: () => style, head: { prepend } } as unknown as Document;

    installDesignSystem(doc);

    expect(prepend).toHaveBeenCalledWith(style);
    expect(style.id).toBe('design-system');
    expect(style.textContent).toContain(`--nav-background: ${themes.panel.nav?.background};`);
    expect(style.textContent).toContain('--density-control-height:');
    expect(style.textContent).toContain('.t-panel-title {');
    expect(style.textContent).toContain('--panel-auth-card-width: 400px;');
    expect(style.textContent).toContain('--panel-dialog-width: 420px;');
    // profile-moderation RC-P4: фото 128 px в карточке модерации профиля
    expect(style.textContent).toContain('--panel-avatar-preview: 128px;');
    // ride-photo PR C: фото организатора 320 px в карточке модерации райда
    expect(style.textContent).toContain('--panel-ride-photo-preview: 320px;');
  });
});
