import { SeasonCard } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { SeasonDetailScreen, seasonDates } from '@/features/races/season-detail';
import { useLoaderSeed } from '@/lib/loader-seed';
import { brandOgImageFor } from '@/lib/og-image';
import { publicPageMetadata } from '@/lib/page-metadata';
import { fetchPublicForSsr, publicPath, ssrData, type PublicSsrResult } from '@/lib/public-ssr';

/*
 * Публичный экран сезона (`/seasons/<id>`): вне гардов, SSR как у карточки гонки — `loader` (сезон) и
 * `generateMetadata` (название и даты) через `public-ssr.ts`.
 */

const seasonForSsr = (
  params: Record<string, string | string[]>,
): Promise<PublicSsrResult<SeasonCard>> => {
  const path = publicPath('/v1/seasons', params.id);
  return path ? fetchPublicForSsr(path, SeasonCard) : Promise.resolve({ status: 'notFound' });
};

export const loader: LoaderFunction<SeasonCard | null> = async (_request, params) =>
  ssrData(await seasonForSsr(params));

/**
 * Мета без ПДн; не найден — нейтральная мета и `noindex`, API недоступен — нейтральная без `robots`. `og:image` —
 * бренд-картинка (своя у сезона — следующий слайс og-images); не найден — без картинки.
 */
export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  const result = await seasonForSsr(params);
  const image = await brandOgImageFor(result);
  if (result.status !== 'found') {
    const neutral = publicPageMetadata({
      title: t('season.title'),
      description: t('app.tagline'),
      image,
    });
    return result.status === 'notFound' ? { ...neutral, robots: 'noindex' } : neutral;
  }
  const season = result.data;
  return publicPageMetadata({
    title: season.name,
    description: seasonDates(season),
    path: `/seasons/${encodeURIComponent(season.id)}`,
    image,
  });
};

export default function SeasonRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const seed = useLoaderSeed<SeasonCard>();
  return <SeasonDetailScreen id={String(id)} seed={seed} />;
}
