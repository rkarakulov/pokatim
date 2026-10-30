import { PublicRiderProfile, RiderPublicId } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { RiderScreen } from '@/features/riders/rider-screen';
import { useLoaderSeed } from '@/lib/loader-seed';
import { ogCardIfOrigin, ownOgImage } from '@/lib/og-image';
import { publicPageMetadata } from '@/lib/page-metadata';
import { fetchPublicForSsr, publicPath, ssrData, type PublicSsrResult } from '@/lib/public-ssr';

/*
 * Публичный профиль райдера (`/riders/<publicId>`, `pokatim://riders/<publicId>`, rider-profile): вне гардов корневого
 * layout — ссылка «Как вас видят другие» открывается без входа. Web — SSR: `loader` сеет запрос. Мета — всегда
 * нейтральная и `noindex`, без `og:url` (D-B2): имя, клуб и фото в мета не попадают ни при каком статусе — согласие
 * можно отозвать, а превью мессенджеров кэшируются навсегда; `publicId` в пути — отзываемая ссылка, как токен письма.
 * `publicId` попадает в мету только в URL `og:image` (RC-1): её видит лишь открывший страницу по тому же `publicId`.
 */

const riderForSsr = (
  params: Record<string, string | string[]>,
): Promise<PublicSsrResult<PublicRiderProfile>> => {
  const path = publicPath('/v1/riders', params.id, '', RiderPublicId);
  return path
    ? fetchPublicForSsr(path, PublicRiderProfile)
    : Promise.resolve({ status: 'notFound' });
};

/** Только сервер (web): посев SSR; нет данных — `null`, экран загрузит их из API сам. */
export const loader: LoaderFunction<PublicRiderProfile | null> = async (_request, params) =>
  ssrData(await riderForSsr(params));

/**
 * Мета: «Профиль райдера» и слоган, `noindex`; без ПДн и без `og:url` при любом ответе API. `og:image`
 * (og-rider-season-dark): своя картинка профиля — статистика без имени, клуба и фото, alt без имени; версии нет или
 * API недоступен — бренд; профиль не найден (нет согласия) — без картинки. Ответ API профиля — из кэша `loader`.
 */
export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  const [result, card] = await Promise.all([
    riderForSsr(params),
    ogCardIfOrigin('rider', params.id),
  ]);
  const image = await ownOgImage({
    kind: 'rider',
    page: result,
    card,
    describe: (profile) => ({ id: profile.publicId, alt: t('ogCard.alt.rider') }),
  });
  return {
    ...publicPageMetadata({ title: t('riders.title'), description: t('app.tagline'), image }),
    robots: 'noindex',
  };
};

export default function RiderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const seed = useLoaderSeed<PublicRiderProfile>();
  return <RiderScreen id={String(id)} seed={seed} />;
}
