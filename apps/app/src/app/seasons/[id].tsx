import { SeasonCard } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { SeasonDetailScreen, seasonDates } from '@/features/races/season-detail';
import { useLoaderSeed } from '@/lib/loader-seed';
import { publicPageMetadata } from '@/lib/page-metadata';
import { fetchPublicForSsr, publicPath } from '@/lib/public-ssr';

/*
 * Публичный экран сезона (`/seasons/<id>`): вне гардов, SSR как у карточки гонки — `loader` (сезон) и
 * `generateMetadata` (название и даты) через `public-ssr.ts`.
 */

const seasonForSsr = (params: Record<string, string | string[]>) => {
  const path = publicPath('/v1/seasons', params.id);
  return path ? fetchPublicForSsr(path, SeasonCard) : Promise.resolve(null);
};

export const loader: LoaderFunction<SeasonCard | null> = (_request, params) => seasonForSsr(params);

/** Мета без ПДн; не найден или API недоступен — нейтральная мета и `noindex`. */
export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  const season = await seasonForSsr(params);
  if (!season) {
    return {
      ...publicPageMetadata({ title: t('season.title'), description: t('app.tagline') }),
      robots: 'noindex',
    };
  }
  return publicPageMetadata({
    title: season.name,
    description: seasonDates(season),
    path: `/seasons/${encodeURIComponent(season.id)}`,
  });
};

export default function SeasonRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const seed = useLoaderSeed<SeasonCard>();
  return <SeasonDetailScreen id={String(id)} seed={seed} />;
}
