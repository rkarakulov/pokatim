import { RideDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { rideShareDescription } from '@/features/rides/format';
import { RideDetailScreen } from '@/features/rides/ride-detail';
import { useLoaderSeed } from '@/lib/loader-seed';
import { ogCardIfOrigin, pageOgImage } from '@/lib/og-image';
import { publicPageMetadata } from '@/lib/page-metadata';
import { fetchPublicForSsr, publicPath, ssrData, type PublicSsrResult } from '@/lib/public-ssr';

/*
 * Публичная карточка кофе-райда (`/rides/<id>`, `pokatim://rides/<id>`): вне гардов корневого layout — ссылка-
 * приглашение открывается без входа. Web — SSR: `loader` сеет запрос, `generateMetadata` даёт `<title>` и OG из
 * публичных полей (без описания и ПДн). Карточки — UGC: всегда `robots: noindex` (Q7).
 */

const rideForSsr = (
  params: Record<string, string | string[]>,
): Promise<PublicSsrResult<RideDetail>> => {
  const path = publicPath('/v1/rides', params.id);
  return path ? fetchPublicForSsr(path, RideDetail) : Promise.resolve({ status: 'notFound' });
};

/** Только сервер (web): посев SSR; нет данных — `null`, экран загрузит их из API сам. */
export const loader: LoaderFunction<RideDetail | null> = async (_request, params) =>
  ssrData(await rideForSsr(params));

/**
 * Мета: название, «{дата с годом}, {время} · {город} · {км} км · темп {a–b} км/ч»; `og:url` — `WEB_ORIGIN` +
 * `/rides/<id>`. Всегда `noindex` (UGC, место встречи); не найден и API недоступен — нейтральная мета. `og:image`
 * (og-images): своя картинка опубликованного райда; отменённый или API недоступен — бренд; не найден — без картинки.
 */
export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  const [result, card] = await Promise.all([rideForSsr(params), ogCardIfOrigin('ride', params.id)]);
  const image = await pageOgImage({ kind: 'ride', page: result, card });
  if (result.status !== 'found') {
    return {
      ...publicPageMetadata({
        title: t('rides.detail.title'),
        description: t('app.tagline'),
        image,
      }),
      robots: 'noindex',
    };
  }
  const ride = result.data;
  return {
    ...publicPageMetadata({
      title: ride.title,
      description: rideShareDescription(ride),
      path: `/rides/${encodeURIComponent(ride.id)}`,
      image,
    }),
    robots: 'noindex',
  };
};

export default function RideRoute() {
  const { id, published, from } = useLocalSearchParams<{
    id: string;
    published?: string;
    from?: string;
  }>();
  const seed = useLoaderSeed<RideDetail>();
  return (
    <RideDetailScreen
      id={String(id)}
      seed={seed}
      published={published === '1'}
      fromNotification={from === 'notification'}
    />
  );
}
