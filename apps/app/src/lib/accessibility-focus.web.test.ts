/// <reference types="jest" />
import type { HostInstance } from 'react-native';

import { focusForAccessibility } from './accessibility-focus';

describe('focusForAccessibility (web)', () => {
  it('заголовок получает фокус, tabindex=-1 — вне порядка Tab', () => {
    const heading = document.createElement('div');
    document.body.appendChild(heading);
    focusForAccessibility(heading as unknown as HostInstance);
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    heading.remove();
  });

  it('нет элемента — ничего', () => {
    expect(() => focusForAccessibility(null)).not.toThrow();
  });
});
