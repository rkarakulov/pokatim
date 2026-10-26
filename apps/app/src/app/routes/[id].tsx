import { CatalogRouteDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { routeShareDescription } from '@/features/routes/format';
import { RouteDetailScreen, routePath } from '@/features/routes/route-detail';
import { useLoaderSeed } from '@/lib/loader-seed';
import { publicPageMetadata } from '@/lib/page-metadata';
import { fetchPublicForSsr, publicPath, ssrData, type PublicSsrResult } from '@/lib/public-ssr';

/*
 * Публичная карточка маршрута каталога (`/routes/<id>`, `pokatim://routes/<id>`, routes-01): вне гардов корневого
 * layout. Web — SSR: `loader` сеет запрос, `generateMetadata` даёт `<title>` и OG из публичных полей маршрута; оба
 * читают API через `public-ssr.ts` (Uuid до запроса, кэш 60 с, ошибка — `null`, не 500).
 */

/** Невалидный id — «не найдено» без запроса во внутренний API. */
const routeForSsr = (
  params: Record<string, string | string[]>,
): Promise<PublicSsrResult<CatalogRouteDetail>> => {
  const path = publicPath('/v1/routes', params.id);
  return path
    ? fetchPublicForSsr(path, CatalogRouteDetail)
    : Promise.resolve({ status: 'notFound' });
};

/** Только сервер (web): посев SSR; нет данных — `null`, экран загрузит их из API сам. */
export const loader: LoaderFunction<CatalogRouteDetail | null> = async (_request, params) =>
  ssrData(await routeForSsr(params));

/**
 * Мета без ПДн (название, «N км · набор M м», город); `og:url` — `WEB_ORIGIN` + `/routes/<id>`. Не найден (снят, не
 * опубликован) — нейтральная мета и `noindex` (мягкий 404: HTML 200); API недоступен — нейтральная мета без `robots`.
 */
export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  const result = await routeForSsr(params);
  if (result.status !== 'found') {
    const neutral = publicPageMetadata({
      title: t('routes.detail.title'),
      description: t('app.tagline'),
    });
    return result.status === 'notFound' ? { ...neutral, robots: 'noindex' } : neutral;
  }
  const route = result.data;
  return publicPageMetadata({
    title: route.title,
    description: routeShareDescription(route),
    path: routePath(route.id),
  });
};

export default function CatalogRouteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const seed = useLoaderSeed<CatalogRouteDetail>();
  return <RouteDetailScreen id={String(id)} seed={seed} />;
}
