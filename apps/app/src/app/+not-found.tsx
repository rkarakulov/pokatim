import { t } from '@pokatim/i18n';
import type { GenerateMetadataFunction } from 'expo-router/server';

import { NotFoundScreen } from '@/components/not-found-screen';
import { publicPageMetadata } from '@/lib/page-metadata';

/** SSR: заголовок вкладки «Страница не найдена» и `noindex` (без `og:url` — адреса нет). */
export const generateMetadata: GenerateMetadataFunction = async () => ({
  ...publicPageMetadata({ title: t('notFound.title'), description: t('app.tagline') }),
  robots: 'noindex',
});

/** Неизвестный адрес — свой экран вместо «Unmatched Route» Expo (B1 смоука dev). */
export default NotFoundScreen;
