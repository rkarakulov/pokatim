import { t } from '@pokatim/i18n';
import type { GenerateMetadataFunction } from 'expo-router/server';

import { brandOgImage } from '@/lib/og-image';
import { publicPageMetadata } from '@/lib/page-metadata';

/**
 * Мета лендинга `/welcome` и корня `/` (G6, RC-3 — одно превью, `og:url` = `/welcome`): без `robots`; к API — только
 * версия бренд-картинки (`og:image`, og-images; кэш процесса 60 с, без `WEB_ORIGIN` — без запроса). `landing.title` уже с брендом — заголовок без суффикса « — Покатим» (RC-2).
 */
export const landingMetadata: GenerateMetadataFunction = async () => {
  const title = t('landing.title');
  const meta = publicPageMetadata({
    title,
    description: t('app.tagline'),
    path: '/welcome',
    image: await brandOgImage(),
  });
  return { ...meta, title, openGraph: { ...meta.openGraph, title } };
};
