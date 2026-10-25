import { RaceDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { raceShareDescription } from '@/features/races/format';
import { RaceDetailScreen } from '@/features/races/race-detail';
import { useLoaderSeed } from '@/lib/loader-seed';
import { publicPageMetadata } from '@/lib/page-metadata';
import { fetchPublicForSsr, publicPath } from '@/lib/public-ssr';

/*
 * Публичная карточка гонки (`/races/<id>`, `pokatim://races/<id>`): вне гардов корневого layout. Web — SSR: `loader`
 * сеет запрос, `generateMetadata` даёт `<title>` и OG из публичных полей гонки; оба читают API через `public-ssr.ts`
 * (Uuid до запроса, кэш 60 с, ошибка — `null`, не 500).
 */

const raceForSsr = (params: Record<string, string | string[]>) => {
  const path = publicPath('/v1/races', params.id);
  return path ? fetchPublicForSsr(path, RaceDetail) : Promise.resolve(null);
};

/** Только сервер (web): посев SSR; нет данных — `null`, экран загрузит их из API сам. */
export const loader: LoaderFunction<RaceDetail | null> = (_request, params) => raceForSsr(params);

/**
 * Мета без ПДн (название, даты окна, класс, дистанция); `og:url` — `WEB_ORIGIN` + `/races/<id>`. Не найдена или API
 * недоступен — нейтральная мета и `noindex` (мягкий 404: HTML с кодом 200, R6).
 */
export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  const race = await raceForSsr(params);
  if (!race) {
    return {
      ...publicPageMetadata({ title: t('races.detail.title'), description: t('app.tagline') }),
      robots: 'noindex',
    };
  }
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
