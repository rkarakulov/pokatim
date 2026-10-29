// Дизайн-система @rkarakulov/ui с брендом проекта: темы (@pokatim/design-tokens), шрифты Inter и
// Playfair Display, словарь проекта. Модуль импортируется первым — в src/app/_layout.tsx и jest.setup.ts:
// без configureDesignSystem компоненты базы бросают ошибку при рендере.
// web: zod без new Function — до создания любой схемы, zod проверяет JIT уже в конструкторе (строгий CSP, ADR-0025)
import '@/features/web-security/zod-jitless';
import { themes } from '@pokatim/design-tokens';
import { i18n } from '@pokatim/i18n';
import { configureDesignSystem } from '@rkarakulov/ui';

import { fontFamilies } from './fonts';

configureDesignSystem({ themes, fonts: fontFamilies, i18n });
