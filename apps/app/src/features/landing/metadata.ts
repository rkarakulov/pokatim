import { t } from '@pokatim/i18n';
import type { GenerateMetadataFunction } from 'expo-router/server';

import { publicPageMetadata } from '@/lib/page-metadata';

/**
 * Мета лендинга `/welcome` и корня `/` (G6, RC-3 — одно превью, `og:url` = `/welcome`): без запросов к API и без
 * `robots`. `landing.title` уже с брендом — заголовок без суффикса « — Покатим» (RC-2).
 */
export const landingMetadata: GenerateMetadataFunction = () => {
  const title = t('landing.title');
  const meta = publicPageMetadata({ title, description: t('app.tagline'), path: '/welcome' });
  return { ...meta, title, openGraph: { ...meta.openGraph, title } };
};
