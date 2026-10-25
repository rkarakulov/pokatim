import { RaceDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { raceShareDescription } from '@/features/races/format';
import { RaceDetailScreen } from '@/features/races/race-detail';
import { useLoaderSeed } from '@/lib/loader-seed';
import { publicPageMetadata } from '@/lib/page-metadata';
import { fetchPublicForSsr, publicPath, ssrData, type PublicSsrResult } from '@/lib/public-ssr';

/*
 * Публичная карточка гонки (`/races/<id>`, `pokatim://races/<id>`): вне гардов корневого layout. Web — SSR: `loader`
 * сеет запрос, `generateMetadata` даёт `<title>` и OG из публичных полей гонки; оба читают API через `public-ssr.ts`
 * (Uuid до запроса, кэш 60 с, ошибка — `null`, не 500).
 */

/** Невалидный id — «не найдено» без запроса во внутренний API. */
const raceForSsr = (
  params: Record<string, string | string[]>,
): Promise<PublicSsrResult<RaceDetail>> => {
  const path = publicPath('/v1/races', params.id);
  return path ? fetchPublicForSsr(path, RaceDetail) : Promise.resolve({ status: 'notFound' });
};

/** Только сервер (web): посев SSR; нет данных — `null`, экран загрузит их из API сам. */
export const loader: LoaderFunction<RaceDetail | null> = async (_request, params) =>
  ssrData(await raceForSsr(params));

/**
 * Мета без ПДн (название, даты окна, класс, дистанция); `og:url` — `WEB_ORIGIN` + `/races/<id>`. Не найдена —
 * нейтральная мета и `noindex` (мягкий 404: HTML с кодом 200, R6); API недоступен — нейтральная мета без `robots`.
 */
export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  const result = await raceForSsr(params);
  if (result.status !== 'found') {
    const neutral = publicPageMetadata({
      title: t('races.detail.title'),
      description: t('app.tagline'),
    });
    return result.status === 'notFound' ? { ...neutral, robots: 'noindex' } : neutral;
  }
  const race = result.data;
  return publicPageMetadata({
    title: race.title,
    description: raceShareDescription(race),
    path: `/races/${encodeURIComponent(race.id)}`,
  });
};

export default function RaceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const seed = useLoaderSeed<RaceDetail>();
  return <RaceDetailScreen id={String(id)} seed={seed} />;
}
