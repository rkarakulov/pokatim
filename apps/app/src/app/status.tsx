import { HealthResponse } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { ApiStatus } from '@/components/api-status';
import { DocumentTitle } from '@/components/document-title';
import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { api } from '@/lib/api';
import { useLoaderSeed } from '@/lib/loader-seed';
import { brandOgImage } from '@/lib/og-image';
import { publicPageMetadata } from '@/lib/page-metadata';

// Публичный экран-образец (без входа, вне вкладок). Данные на всех платформах — из API (TanStack Query);
// на web `loader` — только посев SSR: HTML приходит уже с данными, OG-мета — из `generateMetadata`.

/** Только сервер (web): API по внутреннему адресу; нет адреса или ошибка — без посева, не 500. */
export const loader: LoaderFunction<HealthResponse | null> = async () => {
  const url = process.env.API_INTERNAL_URL;
  if (!url) return null;
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    const parsed = HealthResponse.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * Мета в первых байтах HTML (превью ссылок): `og:url` — только из `WEB_ORIGIN` (`publicPageMetadata`), `og:image` —
 * бренд-картинка (og-images).
 */
export const generateMetadata: GenerateMetadataFunction = async () =>
  publicPageMetadata({
    title: t('status.title'),
    description: t('status.description'),
    path: '/status',
    image: await brandOgImage(),
  });

export default function StatusScreen() {
  const seed = useLoaderSeed<HealthResponse>();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, initialData: seed });

  return (
    <ScreenPlaceholder title="status.title" lead="status.lead">
      {/* заголовок вкладки после клиентской навигации (только web); при SSR — из generateMetadata */}
      <DocumentTitle title={`${t('status.title')} — ${t('app.name')}`} />
      <ApiStatus query={health} />
    </ScreenPlaceholder>
  );
}
