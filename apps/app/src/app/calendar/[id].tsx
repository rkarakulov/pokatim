import { CalendarStartDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction, LoaderFunction } from 'expo-router/server';

import { CalendarDetailScreen } from '@/features/calendar/calendar-detail';
import { calendarShareDescription } from '@/features/calendar/format';
import { useLoaderSeed } from '@/lib/loader-seed';
import { ogCardIfOrigin, pageOgImage } from '@/lib/og-image';
import { publicPageMetadata } from '@/lib/page-metadata';
import { fetchPublicForSsr, publicPath, ssrData, type PublicSsrResult } from '@/lib/public-ssr';

/*
 * Публичная карточка старта календаря (`/calendar/<id>`, `pokatim://calendar/<id>`): вне гардов корневого layout.
 * Web — SSR: `loader` сеет запрос, `generateMetadata` даёт `<title>` и OG из публичных полей старта; оба читают API
 * через `public-ssr.ts` (Uuid до запроса, кэш 60 с, ошибка — `null`, не 500).
 */

/** Невалидный id — «не найдено» без запроса во внутренний API. */
const startForSsr = (
  params: Record<string, string | string[]>,
): Promise<PublicSsrResult<CalendarStartDetail>> => {
  const path = publicPath('/v1/calendar', params.id);
  return path
    ? fetchPublicForSsr(path, CalendarStartDetail)
    : Promise.resolve({ status: 'notFound' });
};

/** Только сервер (web): посев SSR; нет данных — `null`, экран загрузит их из API сам. */
export const loader: LoaderFunction<CalendarStartDetail | null> = async (_request, params) =>
  ssrData(await startForSsr(params));

/**
 * Мета без ПДн (название, дата с годом, дисциплина, город, дистанции); `og:url` — `WEB_ORIGIN` + `/calendar/<id>`.
 * Не найден — нейтральная мета и `noindex` (мягкий 404: HTML 200); API недоступен — нейтральная мета без `robots`.
 * `og:image` (og-images): своя картинка старта; API недоступен — бренд; не найден — без картинки.
 */
export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  const [result, card] = await Promise.all([
    startForSsr(params),
    ogCardIfOrigin('calendar', params.id),
  ]);
  const image = await pageOgImage({ kind: 'calendar', page: result, card });
  if (result.status !== 'found') {
    const neutral = publicPageMetadata({
      title: t('calendar.detail.title'),
      description: t('app.tagline'),
      image,
    });
    return result.status === 'notFound' ? { ...neutral, robots: 'noindex' } : neutral;
  }
  const start = result.data;
  return publicPageMetadata({
    title: start.title,
    description: calendarShareDescription(start),
    path: `/calendar/${encodeURIComponent(start.id)}`,
    image,
  });
};

export default function CalendarStartRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const seed = useLoaderSeed<CalendarStartDetail>();
  return <CalendarDetailScreen id={String(id)} seed={seed} />;
}
